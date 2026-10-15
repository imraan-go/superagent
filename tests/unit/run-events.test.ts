import { describe, expect, it } from "vitest";
import { isTerminal, serialiseFrame } from "@/lib/run-events";
import type { RunEvent } from "@/lib/run-events";

describe("isTerminal", () => {
  it("treats done and error as the end of a stream", () => {
    expect(isTerminal({ type: "done", status: "done" })).toBe(true);
    expect(isTerminal({ type: "done", status: "cancelled" })).toBe(true);
    expect(isTerminal({ type: "error", code: "internal", message: "x" })).toBe(true);
  });

  it("treats a pause for approval as terminal for the stream", () => {
    // The loop genuinely stops; resuming starts a new run, so the client must
    // stop listening rather than wait for frames that will never come.
    expect(isTerminal({ type: "done", status: "paused_approval" })).toBe(true);
  });

  it("does not end the stream on progress events", () => {
    const progress: RunEvent[] = [
      { type: "token", text: "hi" },
      { type: "waiting", reason: "waking", retryInMs: 30_000 },
      { type: "usage", tokensIn: 1, tokensOut: 1, cached: 0, costUsd: 0 },
      {
        type: "approval_required",
        stepIdx: 0,
        tool: "post_tweet",
        reason: "irreversible",
        args: {},
      },
    ];
    for (const event of progress) {
      expect(isTerminal(event), event.type).toBe(false);
    }
  });
});

describe("serialiseFrame", () => {
  it("emits an unnamed SSE event so EventSource.onmessage receives it", () => {
    const wire = serialiseFrame({ seq: 7, event: { type: "token", text: "hi" } });
    expect(wire).toBe('id: 7\ndata: {"type":"token","text":"hi"}\n\n');
    expect(wire).not.toMatch(/^event:/m);
  });
});
