import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/messages";
import { groupExchanges } from "./exchanges";

const msg = (m: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "content">): ChatMessage => ({
  model: null,
  runId: null,
  createdAt: "2026-10-16T08:00:00.000Z",
  ...m,
});

describe("groupExchanges with one persisted turn per run", () => {
  it("reads tool calls, results, questions and the answer from a single assistant message", () => {
    const ex = groupExchanges([
      msg({ id: "u1", role: "user", content: [{ type: "text", text: "Plan dinner" }], runId: "r1" }),
      msg({
        id: "a1",
        role: "assistant",
        runId: "r1",
        content: [
          { type: "question", questionId: "q1", kind: "single", prompt: "Cuisine?", options: [{ id: "a", label: "Thai" }], status: "answered", answer: { choices: ["a"] } },
          { type: "tool_use", id: "t1", name: "browser_navigate", args: { url: "https://example.com" } },
          { type: "tool_result", toolUseId: "t1", name: "browser_navigate", ok: true, text: "navigated", images: ["11111111-1111-4111-8111-111111111111"] },
          { type: "text", text: "Try green curry." },
        ],
      }),
    ]);
    expect(ex).toHaveLength(1);
    expect(ex[0]!.answer).toBe("Try green curry.");
    expect(ex[0]!.questions.map((q) => q.questionId)).toEqual(["q1"]);
    expect(ex[0]!.trace).toEqual([
      expect.objectContaining({ key: "t1", toolName: "browser_navigate", ok: true, detail: "navigated", images: ["11111111-1111-4111-8111-111111111111"] }),
    ]);
  });

  it("shows system notes as their own line and starts the routine's run fresh", () => {
    const ex = groupExchanges([
      msg({ id: "u1", role: "user", content: [{ type: "text", text: "hi" }] }),
      msg({ id: "a1", role: "assistant", content: [{ type: "text", text: "hello" }] }),
      msg({ id: "s1", role: "system", runId: "r2", content: [{ type: "text", text: "Routine “Inbox” is running." }] }),
      msg({ id: "a2", role: "assistant", runId: "r2", content: [{ type: "text", text: "Nothing new." }] }),
    ]);
    expect(ex.map((e) => e.note ?? e.answer)).toEqual(["hello", "Routine “Inbox” is running.", "Nothing new."]);
  });
});
