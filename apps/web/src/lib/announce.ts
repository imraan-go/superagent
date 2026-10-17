import type { RunState } from "@/hooks/use-run-stream";

/**
 * Screen-reader sentence for a run state, or null when nothing should be said.
 * Streaming tokens are deliberately absent: only *transitions* are announced,
 * otherwise a live region would read the reply out word by word.
 */
export function describeRun(run: Pick<RunState, "phase" | "activity" | "approval" | "error">): string | null {
  switch (run.phase) {
    case "thinking":
      return "Agent is thinking.";
    case "tool":
      return run.activity ? `Agent is working: ${run.activity}.` : "Agent is using a tool.";
    case "waiting":
      return run.activity ? `Agent is waiting: ${run.activity}.` : "Agent is waiting.";
    case "approval":
      return run.approval
        ? `Approval needed to run ${run.approval.tool}. Nothing has run yet.`
        : "Approval needed. Nothing has run yet.";
    case "done":
      return "Run finished.";
    case "error":
      return run.error ? `Run failed: ${run.error}` : "Run failed.";
    default:
      return null;
  }
}
