import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { usageEvents } from "@/server/db/schema";
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
}

export interface UsageSummary {
  /** Calendar day in the server's timezone (`YYYY-MM-DD`). */
  day: string;
  today: UsageTotals;
  /** Present only when the subscriber asked for one chat. */
  chat: UsageTotals | null;
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

const ZERO: UsageTotals = { tokensIn: 0, tokensOut: 0, tokensCached: 0, costUsd: 0, calls: 0 };

function totalsSelect() {
  return {
    tokensIn: sql<string>`coalesce(sum(${usageEvents.tokensIn}), 0)`,
    tokensOut: sql<string>`coalesce(sum(${usageEvents.tokensOut}), 0)`,
    tokensCached: sql<string>`coalesce(sum(${usageEvents.tokensCached}), 0)`,
    costUsd: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`,
    calls: sql<string>`count(*)`,
  };
}

function toTotals(row: Record<string, string> | undefined): UsageTotals {
  if (!row) return { ...ZERO };
  return {
    tokensIn: Number(row.tokensIn),
    tokensOut: Number(row.tokensOut),
    tokensCached: Number(row.tokensCached),
    costUsd: Number(row.costUsd),
    calls: Number(row.calls),
  };
}

export function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function usageSummary(chatId: string | null): Promise<UsageSummary> {
  const since = startOfToday();
  const [todayRow] = await db
    .select(totalsSelect())
    .from(usageEvents)
    .where(gte(usageEvents.ts, since));

  let chat: UsageTotals | null = null;
  if (chatId) {
    const [chatRow] = await db
      .select(totalsSelect())
      .from(usageEvents)
      .where(and(eq(usageEvents.chatId, chatId)));
    chat = toTotals(chatRow);
  }

  const today = toTotals(todayRow);
  const usage = await getSection("usage");
  return {
    day: dayKey(since),
    today,
    chat,
    budget: budgetStatus(today.costUsd, usage.dailyBudgetUsd, usage.warnAtPct),
  };
}
