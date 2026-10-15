import "server-only";
import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { schedules } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { callLhosJson, callLhosText } from "./lhos-tools";
import { isValidCron, nextRun } from "./cron";
import { startPromptRun } from "./prompt-run";

/**
 * Schedules (INTEGRATIONS.md §7).
 *
 *  - LHOS schedules: LHOS is the source of truth; `schedules` rows with
 *    `lhos_id` = the LHOS job name are a cache refreshed on every list.
 *  - Panel-native scheduled prompts: rows with `lhos_id IS NULL` and `prompt`
 *    set, run by the in-process scheduler. Their `workflow` column holds JSON
 *    meta `{ name, model, chatId }` (no migrations in Phase 4).
 */
const lhosJob = z
  .object({
    name: z.string(),
    cron: z.string(),
    enabled: z.boolean(),
    target: z.string().optional(),
    next_run_utc: z.string().optional(),
    last_status: z.string().nullable().optional(),
  })
  .passthrough();

/** Never run or enable automatically from the panel (owner instruction). */
export const PROTECTED_LHOS_SCHEDULES = new Set(["snapshot-prune"]);

const panelMeta = z.object({
  name: z.string().default("Scheduled prompt"),
  model: z.string().nullable().default(null),
  chatId: z.string().nullable().default(null),
});
type PanelMeta = z.infer<typeof panelMeta>;

function readMeta(raw: string | null): PanelMeta {
  try {
    return panelMeta.parse(raw ? JSON.parse(raw) : {});
  } catch {
    return panelMeta.parse({});
  }
}

export interface ScheduleView {
  id: string;
  source: "lhos" | "panel";
  name: string;
  cron: string;
  enabled: boolean;
  target: string;
  model: string | null;
  chatId: string | null;
  lastRun: string | null;
  nextRun: string | null;
  lastStatus: string | null;
  protected: boolean;
}

function parseUtc(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s.replace(" ", "T")}${s.length <= 16 ? ":00Z" : "Z"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Pulls LHOS jobs and refreshes the cache rows; returns the live view. */
export async function syncLhosSchedules(): Promise<{ views: ScheduleView[]; error: string | null }> {
  let jobs: z.infer<typeof lhosJob>[];
  try {
    jobs = z.array(lhosJob).parse((await callLhosJson("schedule_list")) ?? []);
  } catch (err) {
    // Serve the cache when LHOS is asleep.
    const cached = await db.select().from(schedules).where(isNotNull(schedules.lhosId));
    return {
      views: cached.map((r) => ({
        id: r.id,
        source: "lhos",
        name: r.lhosId!,
        cron: r.cron,
        enabled: r.enabled,
        target: r.workflow ?? "",
        model: null,
        chatId: null,
        lastRun: r.lastRun?.toISOString() ?? null,
        nextRun: r.nextRun?.toISOString() ?? null,
        lastStatus: null,
        protected: PROTECTED_LHOS_SCHEDULES.has(r.lhosId!),
      })),
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const existing = await db.select().from(schedules).where(isNotNull(schedules.lhosId));
  const byName = new Map(existing.map((r) => [r.lhosId!, r]));
  const views: ScheduleView[] = [];

  for (const job of jobs) {
    const values = {
      lhosId: job.name,
      cron: job.cron,
      workflow: job.target ?? null,
      enabled: job.enabled,
      nextRun: parseUtc(job.next_run_utc),
    };
    const prev = byName.get(job.name);
    let id: string;
    if (prev) {
      await db.update(schedules).set(values).where(eq(schedules.id, prev.id));
      id = prev.id;
      byName.delete(job.name);
    } else {
      const [row] = await db.insert(schedules).values(values).returning({ id: schedules.id });
      id = row!.id;
    }
    views.push({
      id,
      source: "lhos",
      name: job.name,
      cron: job.cron,
      enabled: job.enabled,
      target: job.target ?? "",
      model: null,
      chatId: null,
      lastRun: prev?.lastRun?.toISOString() ?? null,
      nextRun: values.nextRun?.toISOString() ?? null,
      lastStatus: job.last_status ?? null,
      protected: PROTECTED_LHOS_SCHEDULES.has(job.name),
    });
  }
  // Jobs deleted on LHOS disappear from the cache too.
  for (const stale of byName.values()) await db.delete(schedules).where(eq(schedules.id, stale.id));

  return { views, error: null };
}

export async function listPanelSchedules(): Promise<ScheduleView[]> {
  const rows = await db.select().from(schedules).where(and(isNull(schedules.lhosId), isNotNull(schedules.prompt)));
  return rows.map((r) => {
    const meta = readMeta(r.workflow);
    return {
      id: r.id,
      source: "panel",
      name: meta.name,
      cron: r.cron,
      enabled: r.enabled,
      target: r.prompt ?? "",
      model: meta.model,
      chatId: meta.chatId,
      lastRun: r.lastRun?.toISOString() ?? null,
      nextRun: r.nextRun?.toISOString() ?? null,
      lastStatus: null,
      protected: false,
    };
  });
}

export const createScheduleSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("lhos"),
    name: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,64}$/, "Use letters, digits, dash, dot or underscore."),
    cron: z.string().trim().refine(isValidCron, "Invalid cron expression."),
    workflow: z.string().trim().min(1).max(120),
  }),
  z.object({
    source: z.literal("panel"),
    name: z.string().trim().min(1).max(80),
    cron: z.string().trim().refine(isValidCron, "Invalid cron expression."),
    prompt: z.string().trim().min(1).max(8000),
    model: z.string().trim().min(1).max(120).optional(),
  }),
]);

export async function createSchedule(input: z.infer<typeof createScheduleSchema>): Promise<void> {
  if (input.source === "lhos") {
    if (PROTECTED_LHOS_SCHEDULES.has(input.name)) throw new AppError("bad_request", "That name is reserved.");
    await callLhosText("schedule_create", { name: input.name, cron: input.cron, workflow: input.workflow, enabled: true });
    await syncLhosSchedules();
    return;
  }
  await db.insert(schedules).values({
    cron: input.cron,
    prompt: input.prompt,
    workflow: JSON.stringify({ name: input.name, model: input.model ?? null, chatId: null }),
    enabled: true,
    nextRun: nextRun(input.cron),
  });
}

async function getRow(id: string) {
  if (!z.uuid().safeParse(id).success) throw new AppError("not_found", "No such schedule.");
  const [row] = await db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
  if (!row) throw new AppError("not_found", "No such schedule.");
  return row;
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<void> {
  const row = await getRow(id);
  if (row.lhosId) {
    if (enabled && PROTECTED_LHOS_SCHEDULES.has(row.lhosId)) {
      throw new AppError("bad_request", `"${row.lhosId}" is protected and cannot be enabled from the panel.`);
    }
    await callLhosText("schedule_enable", { name: row.lhosId, on: enabled });
    await db.update(schedules).set({ enabled }).where(eq(schedules.id, id));
    return;
  }
  await db
    .update(schedules)
    .set({ enabled, nextRun: enabled ? nextRun(row.cron) : null })
    .where(eq(schedules.id, id));
}

export async function deleteSchedule(id: string): Promise<void> {
  const row = await getRow(id);
  if (row.lhosId) {
    if (PROTECTED_LHOS_SCHEDULES.has(row.lhosId)) throw new AppError("bad_request", "That schedule is protected.");
    await callLhosText("schedule_delete", { name: row.lhosId });
  }
  await db.delete(schedules).where(eq(schedules.id, id));
}

export async function runScheduleNow(id: string): Promise<{ chatId?: string; runId?: string; output?: string }> {
  const row = await getRow(id);
  if (row.lhosId) {
    if (PROTECTED_LHOS_SCHEDULES.has(row.lhosId)) throw new AppError("bad_request", "That schedule is protected.");
    const output = await callLhosText("schedule_run_now", { name: row.lhosId });
    await db.update(schedules).set({ lastRun: new Date() }).where(eq(schedules.id, id));
    return { output: output.slice(0, 2000) };
  }
  return firePanelSchedule(row);
}

async function firePanelSchedule(row: typeof schedules.$inferSelect): Promise<{ chatId: string; runId: string }> {
  const meta = readMeta(row.workflow);
  const started = await startPromptRun({
    text: row.prompt ?? "",
    model: meta.model,
    chatId: meta.chatId,
    title: `⏱ ${meta.name}`,
  });
  await db
    .update(schedules)
    .set({
      lastRun: new Date(),
      workflow: JSON.stringify({ ...meta, chatId: started.chatId }),
    })
    .where(eq(schedules.id, row.id));
  return started;
}

/** One scheduler tick: fire every due, enabled panel schedule. */
export async function tickPanelSchedules(now: Date = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(schedules)
    .where(
      and(
        isNull(schedules.lhosId),
        isNotNull(schedules.prompt),
        eq(schedules.enabled, true),
        lte(schedules.nextRun, now),
      ),
    );

  for (const row of due) {
    // Advance first so a crash mid-run never re-fires the same slot.
    let next: Date | null = null;
    try {
      next = nextRun(row.cron, now);
    } catch {
      next = null;
    }
    await db.update(schedules).set({ nextRun: next }).where(eq(schedules.id, row.id));
    try {
      await firePanelSchedule(row);
      logger.info("scheduler", { id: row.id, msg: "fired" });
    } catch (err) {
      logger.warn("scheduler", { id: row.id, msg: "fire failed", detail: String(err) });
    }
  }
  return due.length;
}
