/**
 * Pure helpers for the Mission rail's activity log and "Waiting on you" card.
 * No React, no fetch — unit-tested in rail-log.test.ts.
 */

export type LogSource = "chat" | "computer";
export type LogFilter = "all" | "chat" | "computer" | "errors";

export interface LogEntry {
  key: string;
  source: LogSource;
  /** Epoch ms. */
  ts: number;
  tool: string;
  label: string;
  /** null while still running. */
  ok: boolean | null;
  ms: number | null;
  detail?: string | null;
}

export interface ChatStepInput {
  idx: number;
  toolName: string | null;
  label: string;
  ok: boolean | null;
  ms: number | null;
  type?: string;
  /** Epoch ms the step was first seen (the run stream has no timestamp). */
  seenAt: number;
}

export interface LhosEventInput {
  ts: number;
  iso?: string;
  tool: string;
  ms?: number;
  ok?: boolean;
  err?: string | null;
}

/** LHOS event `ts` is unix seconds on some builds and ms on others. */
export function eventMs(e: Pick<LhosEventInput, "ts" | "iso">): number {
  if (e.iso) {
    const t = Date.parse(e.iso);
    if (!Number.isNaN(t)) return t;
  }
  return e.ts < 1e12 ? e.ts * 1000 : e.ts;
}

export function mergeLog(
  steps: readonly ChatStepInput[],
  events: readonly LhosEventInput[],
  runId: string | null,
  limit = 200,
): LogEntry[] {
  const out: LogEntry[] = [];
  for (const s of steps) {
    out.push({
      key: `chat:${runId ?? ""}:${s.idx}`,
      source: "chat",
      ts: s.seenAt,
      tool: s.toolName ?? s.type ?? "step",
      label: s.label,
      ok: s.ok,
      ms: s.ms,
    });
  }
  events.forEach((e, i) => {
    const ts = eventMs(e);
    out.push({
      key: `computer:${ts}:${e.tool}:${i}`,
      source: "computer",
      ts,
      tool: e.tool,
      label: e.err ? e.err : e.tool.replace(/_/g, " "),
      ok: e.ok ?? null,
      ms: e.ms ?? null,
      detail: e.err ?? null,
    });
  });
  // Newest first; ties keep chat steps above computer events, then by key.
  out.sort(
    (a, b) =>
      b.ts - a.ts || (a.source === b.source ? (a.key < b.key ? 1 : -1) : a.source === "chat" ? -1 : 1),
  );
  return out.slice(0, limit);
}

export function filterLog(entries: readonly LogEntry[], filter: LogFilter): LogEntry[] {
  switch (filter) {
    case "chat":
      return entries.filter((e) => e.source === "chat");
    case "computer":
      return entries.filter((e) => e.source === "computer");
    case "errors":
      return entries.filter((e) => e.ok === false);
    default:
      return [...entries];
  }
}

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function groupStale<T extends { createdAt: string }>(
  items: readonly T[],
  now = Date.now(),
  staleAfterMs = STALE_AFTER_MS,
): { fresh: T[]; stale: T[] } {
  const fresh: T[] = [];
  const stale: T[] = [];
  for (const item of items) {
    const t = Date.parse(item.createdAt);
    if (!Number.isNaN(t) && now - t > staleAfterMs) stale.push(item);
    else fresh.push(item);
  }
  return { fresh, stale };
}

/** "12.3k" style compaction for token counts. */
export function compactNumber(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function clockTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
