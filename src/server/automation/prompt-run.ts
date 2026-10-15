import "server-only";
import { asc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { audit, settings, usageEvents, users } from "@/server/db/schema";
import { isActive } from "@/server/agent/registry";
import { logger } from "@/server/lib/logger";
import { startAgentRun } from "@/server/agent/loop";
import { appendMessage, createChat, getChat } from "@/server/chat/repo";
import { AppError } from "@/server/lib/errors";
import { findModel, resolveDefaultModel } from "@/server/models";
import type { ModelEntry } from "@/server/models";

const DEFAULT_DAILY_BUDGET_USD = 10;
const g = globalThis as unknown as { __fdUnattended?: Set<string> };
const unattended: Set<string> = (g.__fdUnattended ??= new Set());

/**
 * Single swap point for model resolution of unattended runs. Replace with the
 * settings-aware default resolver at merge time.
 */
export function resolveUnattendedModel(requested?: string | null): ModelEntry {
  return (requested ? findModel(requested) : undefined) ?? resolveDefaultModel();
}

async function dailyBudgetUsd(): Promise<number> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "usage")).limit(1);
  const v = (row?.value as { dailyBudgetUsd?: unknown } | undefined)?.dailyBudgetUsd;
  return typeof v === "number" && v >= 0 ? v : DEFAULT_DAILY_BUDGET_USD;
}

/**
 * Budget guard for unattended runs (schedules + webhooks): one at a time, and
 * none once today's spend (since local midnight) reaches the daily budget.
 * Refusals are logged and recorded in `audit`.
 */
async function guardUnattended(source: string): Promise<void> {
  for (const id of unattended) if (!isActive(id)) unattended.delete(id);
  let reason: string | null = null;
  if (unattended.size > 0) {
    reason = "another unattended run is still active";
  } else {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
      .from(usageEvents)
      .where(gte(usageEvents.ts, midnight));
    const spent = Number(row?.total ?? 0);
    const budget = await dailyBudgetUsd();
    if (spent >= budget) reason = `daily budget reached ($${spent.toFixed(2)} of $${budget.toFixed(2)})`;
  }
  if (reason) {
    logger.warn("automation", { msg: "unattended run refused", source, reason });
    await db.insert(audit).values({
      who: "automation",
      action: "unattended_run_refused",
      detail: { source, reason },
      ok: false,
      result: reason,
    });
    throw new AppError("budget_exceeded", `Unattended run refused: ${reason}.`);
  }
}

/** The single owner (single-owner product; README golden rule 3). */
export async function ownerUserId(): Promise<string> {
  const [row] = await db.select({ id: users.id }).from(users).orderBy(asc(users.createdAt)).limit(1);
  if (!row) throw new AppError("internal", "No owner account exists yet.");
  return row.id;
}

/**
 * Starts an unattended agent run (schedule or webhook). Uses `chatId` when it
 * still exists, otherwise creates a chat titled `title`.
 */
export async function startPromptRun(input: {
  text: string;
  model?: string | null | undefined;
  chatId?: string | null | undefined;
  title: string;
}): Promise<{ chatId: string; runId: string }> {
  await guardUnattended(input.title);
  const userId = await ownerUserId();
  const model = resolveUnattendedModel(input.model);

  let chatId: string | null = null;
  if (input.chatId) {
    try {
      const chat = await getChat(input.chatId, userId);
      if (chat.status === "running") throw new AppError("conflict", "The previous run is still going.");
      chatId = chat.id;
    } catch (err) {
      if (err instanceof AppError && err.code === "conflict") throw err;
      chatId = null;
    }
  }
  if (!chatId) chatId = (await createChat(userId, { title: input.title.slice(0, 120), model: model.id })).id;

  await appendMessage(chatId, userId, { role: "user", content: [{ type: "text", text: input.text }] });
  const runId = await startAgentRun({ chatId, userId, modelId: model.id });
  unattended.add(runId);
  return { chatId, runId };
}
