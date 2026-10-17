/**
 * Shared shapes for human-in-the-loop items (server route ↔ Mission panel).
 */
import type { QuestionPart } from './messages';

export type HitlKind = 'confirm' | 'ask';

export interface ApprovalDetail {
  tool: string;
  account: { toolkit: string; label: string } | null;
  destination: Record<string, unknown>;
  args: Record<string, unknown>;
  /** Echoed back with the decision: the server refuses it if the action changed since display. */
  argsHash: string;
  nonce: string;
  expiresAt: string;
}

export interface PendingItem {
  id: string;
  source: 'approval' | 'question';
  kind: HitlKind;
  prompt: string;
  createdAt: string;
  runId: string | null;
  chatId: string | null;
  approval?: ApprovalDetail;
  question?: QuestionPart;
}

export interface PendingResponse {
  count: number;
  items: PendingItem[];
  running: number;
}

/** Polling cadence (skill-approvals-hitl §Gotchas): fast while anything is live. */
export function pendingPollMs(
  data: Pick<PendingResponse, 'count' | 'running'> | undefined,
  localRunActive = false,
): number {
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
  if (s < 45) return 'just now';
  if (s < 3_600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3_600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

/** Window event the Computer panel listens for (open the screen view). */
export const OPEN_COMPUTER_EVENT = 'sa:open-computer';
/** Fired after a decision so the chat re-attaches to the run. */
export const RUN_RESUMED_EVENT = 'sa:run-resumed';
export interface RunResumedDetail {
  runId: string;
  chatId: string;
}
