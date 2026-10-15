import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { runSteps, runs, usageEvents } from "@/server/db/schema";
import { getSection } from "@/server/settings/store";
import { budgetStatus } from "@/lib/usage-budget";
import type { BudgetStatus } from "@/lib/usage-budget";

/**
 * Live usage ticker (skill-token-metering §3).
 *
 * The agent loop calls `notifyUsage()` after every `usage_events` insert; the
 * `/api/usage/live` SSE route subscribes and pushes a fresh summary. The bus is
 * in-process on `globalThis` (ADR-04 single instance; survives dev HMR).
 */
export interface UsageTotals {
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number;
  calls: number;
  /** Tool steps recorded in `run_steps` for the same scope. */
  toolCalls: number;
}

export interface ToolStats {
  toolCalls: number;
  toolOk: number;
  toolFailed: number;
  /** Mean latency of finished tool steps, ms; null when none finished. */
  avgToolMs: number | null;
}

export interface UsageSummary {
  /** Calendar day in the server's timezone (`YYYY-MM-DD`). */
  day: string;
  today: UsageTotals;
  /** Present only when the subscriber asked for one chat. */
  chat: UsageTotals | null;
  /** Present only when the subscriber asked for one run. */
  run: UsageTotals | null;
  /** Today's tool-step outcomes (from `run_steps`). */
  stats: ToolStats;
  /** Null when no daily budget is set (usage.dailyBudgetUsd = 0). */
  budget: BudgetStatus | null;
}

type Listener = (chatId: string | null) => void;

const g = globalThis as unknown as { __usageListeners?: Set<Listener> };
const listeners: Set<Listener> = (g.__usageListeners ??= new Set());

export function notifyUsage(chatId: string | null): void {
  for (const l of listeners) {
    try {
      l(chatId);
    } catch {
      // A broken subscriber must not break the agent loop.
    }
  }
}

export function onUsage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const ZERO: UsageTotals = {
  tokensIn: 0,
  tokensOut: 0,
  tokensCached: 0,
  costUsd: 0,
  calls: 0,
  toolCalls: 0,
};

function totalsSelect() {
  return {
    tokensIn: sql<string>`coalesce(sum(${usageEvents.tokensIn}), 0)`,
    tokensOut: sql<string>`coalesce(sum(${usageEvents.tokensOut}), 0)`,
    tokensCached: sql<string>`coalesce(sum(${usageEvents.tokensCached}), 0)`,
    costUsd: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`,
    calls: sql<string>`count(*)`,
  };
}

function toTotals(row: Record<string, string> | undefined, toolCalls = 0): UsageTotals {
  if (!row) return { ...ZERO, toolCalls };
  return {
    tokensIn: Number(row.tokensIn),
    tokensOut: Number(row.tokensOut),
    tokensCached: Number(row.tokensCached),
    costUsd: Number(row.costUsd),
    calls: Number(row.calls),
    toolCalls,
  };
}

async function toolCount(where: SQL | undefined): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(runSteps)
    .innerJoin(runs, eq(runSteps.runId, runs.id))
    .where(where);
  return Number(row?.n ?? 0);
}

async function toolStats(since: Date): Promise<ToolStats> {
  const [row] = await db
    .select({
      n: sql<string>`count(*)`,
      ok: sql<string>`count(*) filter (where ${runSteps.ok} = true)`,
      failed: sql<string>`count(*) filter (where ${runSteps.ok} = false)`,
      avgMs: sql<string | null>`avg(${runSteps.ms})`,
    })
    .from(runSteps)
    .where(and(eq(runSteps.type, "tool"), gte(runSteps.createdAt, since)));
  return {
    toolCalls: Number(row?.n ?? 0),
    toolOk: Number(row?.ok ?? 0),
    toolFailed: Number(row?.failed ?? 0),
    avgToolMs: row?.avgMs == null ? null : Math.round(Number(row.avgMs)),
  };
}

export function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function usageSummary(
  chatId: string | null,
  runId: string | null = null,
): Promise<UsageSummary> {
  const since = startOfToday();
  const isTool = eq(runSteps.type, "tool");
  const [[todayRow], stats] = await Promise.all([
    db.select(totalsSelect()).from(usageEvents).where(gte(usageEvents.ts, since)),
    toolStats(since),
  ]);

  let chat: UsageTotals | null = null;
  if (chatId) {
    const [[chatRow], tools] = await Promise.all([
      db.select(totalsSelect()).from(usageEvents).where(eq(usageEvents.chatId, chatId)),
      toolCount(and(isTool, eq(runs.chatId, chatId))),
    ]);
    chat = toTotals(chatRow, tools);
  }

  let run: UsageTotals | null = null;
  if (runId) {
    const [[runRow], tools] = await Promise.all([
      db.select(totalsSelect()).from(usageEvents).where(eq(usageEvents.runId, runId)),
      toolCount(and(isTool, eq(runSteps.runId, runId))),
    ]);
    run = toTotals(runRow, tools);
  }

  const today = toTotals(todayRow, stats.toolCalls);
  const usage = await getSection("usage");
  return {
    day: dayKey(since),
    today,
    chat,
    run,
    stats,
    budget: budgetStatus(today.costUsd, usage.dailyBudgetUsd, usage.warnAtPct),
  };
}

export async function runInChat(runId: string, chatId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.chatId, chatId)))
    .limit(1);
  return Boolean(row);
}
