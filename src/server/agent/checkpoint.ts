import { z } from "zod";
import type { MessagePart } from "@/lib/messages";

/**
 * Pure logic for pausing and resuming a run at an approval checkpoint.
 *
 * Kept free of I/O so the ordering rules — which are the part that must never
 * be wrong — are unit-tested directly (tests/unit/checkpoint.test.ts).
 */

export const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

/**
 * Everything needed to finish the paused assistant turn, stored on the
 * `approval` run step's `result` column. The turn may have asked for several
 * tools; the ones before the gated call already ran and their results are kept
 * here so the resumed turn produces one tool message covering every call.
 */
export const checkpointStateSchema = z.object({
  v: z.literal(1),
  calls: z.array(toolCallSchema).min(1),
  pendingIndex: z.number().int().nonnegative(),
  completed: z.array(z.record(z.string(), z.unknown())),
  /** Composer chips of the paused run, so the resumed run stays narrowed. */
  capabilities: z.array(z.string().max(32)).max(12).optional(),
});
export type CheckpointState = z.infer<typeof checkpointStateSchema>;

export type Decision = "approve" | "reject";

/**
 * What to do with each remaining call of the paused turn, in order:
 *
 *  - `run`    — the owner approved this exact call; execute without re-gating.
 *  - `gate`   — a later call; it passes through the policy again and may pause
 *               the run a second time.
 *  - `reject` — the owner said no; the model is told so.
 *  - `skip`   — a later call in a rejected turn; never executed, because the
 *               model planned it assuming the rejected action had happened.
 */
export type ResumeAction = "run" | "gate" | "reject" | "skip";

export interface PlannedCall {
  call: ToolCall;
  action: ResumeAction;
}

export function planResume(state: CheckpointState, decision: Decision): PlannedCall[] {
  const pending = state.calls[state.pendingIndex];
  if (!pending) throw new Error("Checkpoint state has no pending call.");
  const rest = state.calls.slice(state.pendingIndex + 1);

  if (decision === "approve") {
    return [
      { call: pending, action: "run" },
      ...rest.map((call) => ({ call, action: "gate" as const })),
    ];
  }
  return [
    { call: pending, action: "reject" },
    ...rest.map((call) => ({ call, action: "skip" as const })),
  ];
}

export const REJECTED_TEXT =
  "The owner REJECTED this action. It was not executed. Do not retry it or work around it; acknowledge the decision and either continue with what does not need it or stop and explain.";
export const SKIPPED_TEXT =
  "Not executed: an earlier action in this turn was rejected by the owner.";
export const EXPIRED_TEXT =
  "Not executed: the owner moved on without approving this action.";

/** A synthetic tool result for a call that never ran. */
export function syntheticResult(call: ToolCall, text: string): MessagePart {
  return {
    type: "tool_result",
    toolUseId: call.id,
    name: call.name,
    ok: false,
    text,
    images: [],
  };
}

/* ------------------------------------------------------- reconciliation -- */

export interface TrackedItem {
  /** Panel row id. */
  id: string;
  lhosApprovalId: string;
  kind: "confirm" | "ask" | "takeover";
}

export interface Reconciled {
  id: string;
  decidedVia: "lhos-page" | "desktop";
}

/**
 * Items the panel recorded as pending that LHOS no longer lists were decided
 * somewhere else. A `confirm` can only be decided on the LHOS approvals page;
 * an `ask`/`takeover` is answered from the desktop dialog.
 *
 * Callers must only pass `liveIds` from a *successful* fetch — an unreachable
 * LHOS returns nothing, and treating that as "everything was decided" would
 * silently close every open request.
 */
export function reconcile(tracked: readonly TrackedItem[], liveIds: ReadonlySet<string>): Reconciled[] {
  return tracked
    .filter((t) => !liveIds.has(t.lhosApprovalId))
    .map((t) => ({ id: t.id, decidedVia: t.kind === "confirm" ? "lhos-page" : "desktop" }));
}

/** Panel ids are uuids; LHOS ids are 8 hex characters. */
export function approvalSource(id: string): "panel" | "lhos" | null {
  if (/^[0-9a-f]{8}$/.test(id)) return "lhos";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return "panel";
  return null;
}
