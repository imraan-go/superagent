import { describe, expect, it } from "vitest";
import { buildAnthropicBody } from "@/server/models/adapters/anthropic";
import type { CompletionRequest } from "@/server/models/types";

const base: CompletionRequest = {
  model: "claude-haiku-5-5",
  system: "SYS",
  messages: [
    { role: "user", content: [{ type: "text", text: "hi" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "observe", args: {} }] },
    {
      role: "user",
      content: [
        { type: "tool_result", toolUseId: "t1", ok: true, text: "ok", images: [{ mime: "image/jpeg", data_b64: "AAAA" }] },
      ],
    },
  ],
  tools: [{ name: "observe", description: "Look", inputSchema: { type: "object" } }],
  maxTokens: 4096,
};

describe("anthropic request shaping", () => {
  it("Default mode: no thinking field, temperature passes through", () => {
    const body = buildAnthropicBody({ ...base, temperature: 0.2 });
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect(body.temperature).toBe(0.2);
  });

  it("Thinking mode: adaptive + summarized, effort high, no budget_tokens, no temperature", () => {
    const body = buildAnthropicBody({ ...base, thinking: true, temperature: 0.2, maxTokens: 16000 });
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({ effort: "high" });
    expect(JSON.stringify(body)).not.toContain("budget_tokens");
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBe(16000);
  });

  it("sends tool-result screenshots as image blocks inside the tool_result", () => {
    const body = buildAnthropicBody(base);
    const msgs = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
    const result = msgs[2]!.content[0]!;
    expect(result.type).toBe("tool_result");
    expect(result.content).toEqual([
      { type: "text", text: "ok" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
    ]);
  });

  it("caches the stable system prefix and the newest message block", () => {
    const body = buildAnthropicBody({ ...base, systemParts: { stable: "STABLE", volatile: "NOW" } });
    expect(body.system).toEqual([
      { type: "text", text: "STABLE", cache_control: { type: "ephemeral" } },
      { type: "text", text: "NOW" },
    ]);
    const msgs = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
    expect(msgs[2]!.content[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(msgs[0]!.content[0]!.cache_control).toBeUndefined();
  });

  it("falls back to the plain system string without parts", () => {
    expect(buildAnthropicBody(base).system).toBe("SYS");
  });
});
