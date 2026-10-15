/**
 * The agent run's wire protocol, shared by the SSE route and the chat UI.
 *
 * Every frame carries a monotonic `seq` used as the SSE event id, so a client
 * that reconnects with `Last-Event-ID` can be replayed exactly (ADR-05).
 */
import type { ChatMessage } from "./messages";

export interface RunStepView {
  idx: number;
  type: "think" | "tool" | "observe" | "approval" | "takeover" | "waiting";
  toolName: string | null;
  /** Plain-language summary for the activity line. */
  label: string;
  ok: boolean | null;
  ms: number | null;
  /** Trimmed result text; the full payload lives in `run_steps`. */
  preview?: string;
  images?: string[];
}

export type RunEvent =
  | { type: "run_started"; runId: string; chatId: string; model: string }
  /** Coalesced assistant text; append in order. */
  | { type: "token"; text: string }
  | { type: "step"; step: RunStepView }
  | { type: "step_done"; step: RunStepView }
  /** The agent computer is waking; the loop retries automatically. */
  | { type: "waiting"; reason: string; retryInMs: number }
  | {
      type: "approval_required";
      stepIdx: number;
      tool: string;
      reason: string;
      args: Record<string, unknown>;
    }
  | { type: "usage"; tokensIn: number; tokensOut: number; cached: number; costUsd: number }
  /** A persisted turn — replaces any streamed text for that turn. */
  | { type: "message"; message: ChatMessage }
  | { type: "done"; status: "done" | "cancelled" | "paused_approval" }
  | { type: "error"; code: string; message: string };

export interface RunFrame {
  seq: number;
  event: RunEvent;
}

/** Terminal frames tell the client to stop listening. */
export function isTerminal(event: RunEvent): boolean {
  return event.type === "done" || event.type === "error";
}
