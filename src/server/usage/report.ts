import "server-only";
import { and, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { chats, usageEvents } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";

/**
 * Usage aggregation for Settings → Usage and its CSV export. Grouped in SQL;
 * sorting happens client-side (the result is at most a few hundred rows).
 */
export const USAGE_GROUPS = ["day", "vendor", "model", "chat"] as const;
export type UsageGroup = (typeof USAGE_GROUPS)[number];

export const usageQuerySchema = z.object({
  groupBy: z.enum(USAGE_GROUPS).default("day"),
  /** Inclusive start, `YYYY-MM-DD` (UTC). */
  from: z.iso.date().optional(),
  /** Inclusive end, `YYYY-MM-DD` (UTC). */
  to: z.iso.date().optional(),
});
export type UsageQuery = z.infer<typeof usageQuerySchema>;

export interface UsageRow {
  key: string;
  label: string;
  events: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number;
}

export interface UsageReport {
  groupBy: UsageGroup;
  from: string;
  to: string;
  rows: UsageRow[];
  totals: Omit<UsageRow, "key" | "label">;
  /** Spend so far today (UTC) — for the daily budget readout. */
  todayUsd: number;
}

const DAY_MS = 86_400_000;

export function parseUsageQuery(url: URL): UsageQuery {
  const parsed = usageQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    throw new AppError("bad_request", parsed.error.issues[0]?.message ?? "Invalid query.");
  }
  return parsed.data;
}

export async function usageReport(query: UsageQuery): Promise<UsageReport> {
  const today = new Date().toISOString().slice(0, 10);
  const to = query.to ?? today;
  const from = query.from ?? new Date(Date.parse(to) - 29 * DAY_MS).toISOString().slice(0, 10);
  if (from > to) throw new AppError("bad_request", "`from` must not be after `to`.");

  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(Date.parse(`${to}T00:00:00.000Z`) + DAY_MS);

  const keyExpr = {
    day: sql<string>`to_char(${usageEvents.ts} at time zone 'UTC', 'YYYY-MM-DD')`,
    vendor: sql<string>`${usageEvents.vendor}`,
    model: sql<string>`${usageEvents.model}`,
    chat: sql<string>`coalesce(${usageEvents.chatId}::text, '')`,
  }[query.groupBy];

  const labelExpr =
    query.groupBy === "chat"
      ? sql<string>`coalesce(max(${chats.title}), '(deleted chat)')`
      : sql<string>`${keyExpr}`;

  const rows = await db
    .select({
      key: keyExpr,
      label: labelExpr,
      events: sql<number>`count(*)::int`,
      tokensIn: sql<number>`coalesce(sum(${usageEvents.tokensIn}), 0)::bigint`,
      tokensOut: sql<number>`coalesce(sum(${usageEvents.tokensOut}), 0)::bigint`,
      tokensCached: sql<number>`coalesce(sum(${usageEvents.tokensCached}), 0)::bigint`,
      costUsd: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`,
    })
    .from(usageEvents)
    .leftJoin(chats, sql`${chats.id} = ${usageEvents.chatId}`)
    .where(and(gte(usageEvents.ts, start), lt(usageEvents.ts, end)))
    .groupBy(keyExpr)
    .orderBy(keyExpr);

  const [todayRow] = await db
    .select({ cost: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
    .from(usageEvents)
    .where(gte(usageEvents.ts, new Date(`${today}T00:00:00.000Z`)));

  const normalised: UsageRow[] = rows.map((r) => ({
    key: r.key,
    label: r.label,
    events: Number(r.events),
    tokensIn: Number(r.tokensIn),
    tokensOut: Number(r.tokensOut),
    tokensCached: Number(r.tokensCached),
    costUsd: Number(r.costUsd),
  }));

  const totals = normalised.reduce(
    (acc, r) => ({
      events: acc.events + r.events,
      tokensIn: acc.tokensIn + r.tokensIn,
      tokensOut: acc.tokensOut + r.tokensOut,
      tokensCached: acc.tokensCached + r.tokensCached,
      costUsd: acc.costUsd + r.costUsd,
    }),
    { events: 0, tokensIn: 0, tokensOut: 0, tokensCached: 0, costUsd: 0 },
  );
  totals.costUsd = Number(totals.costUsd.toFixed(6));

  return {
    groupBy: query.groupBy,
    from,
    to,
    rows: normalised,
    totals,
    todayUsd: Number(todayRow?.cost ?? 0),
  };
}

/** RFC 4180 CSV. Cells starting with formula characters are neutralised. */
export function usageCsv(report: UsageReport): string {
  const header = [report.groupBy, "label", "events", "tokens_in", "tokens_out", "tokens_cached", "cost_usd"];
  const lines = [header, ...report.rows.map((r) => [
    r.key,
    r.label,
    r.events,
    r.tokensIn,
    r.tokensOut,
    r.tokensCached,
    r.costUsd.toFixed(6),
  ])];
  return `${lines.map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
