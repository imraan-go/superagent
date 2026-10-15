/**
 * Shared shapes for human-in-the-loop items (server route ↔ Mission panel).
 */
export type HitlKind = "confirm" | "ask" | "takeover";

export interface PendingItem {
  /** Panel uuid (`source: "panel"`) or LHOS 8-hex id (`source: "lhos"`). */
  id: string;
  source: "panel" | "lhos";
  kind: HitlKind;
  prompt: string;
  createdAt: string;
  runId: string | null;
  chatId: string | null;
}

export interface PendingResponse {
  reachable: boolean;
  count: number;
  items: PendingItem[];
  running: number;
}

/** Polling cadence (skill-approvals-hitl §Gotchas): fast while anything is live. */
export function pendingPollMs(data: Pick<PendingResponse, "count" | "running"> | undefined, localRunActive = false): number {
  return localRunActive || (data?.count ?? 0) > 0 || (data?.running ?? 0) > 0 ? 5_000 : 60_000;
}

/** Items present now that were not in the previous poll — what to announce. */
export function newItems(previous: readonly PendingItem[] | undefined, current: readonly PendingItem[]): PendingItem[] {
  if (!previous) return [];
  const seen = new Set(previous.map((i) => `${i.source}:${i.id}`));
  return current.filter((i) => !seen.has(`${i.source}:${i.id}`));
}

/** "just now", "4m", "2h", "3d" — compact age for a pending item. */
export function formatAge(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  if (s < 3_600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3_600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

/** Window event the Computer panel listens for (takeover → open the screen). */
export const OPEN_COMPUTER_EVENT = "lhos:open-computer";
/** Fired after a checkpoint decision so the chat re-attaches to the run. */
export const RUN_RESUMED_EVENT = "lhos:run-resumed";
export interface RunResumedDetail {
  runId: string;
  chatId: string;
}
