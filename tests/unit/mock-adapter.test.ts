import { describe, expect, it } from "vitest";
import { MockAdapter } from "@/server/models/adapters/mock";
import type { CompletionRequest, StreamEvent } from "@/server/models/types";

/**
 * The mock adapter is what the agent loop is built against until a vendor key
 * exists, so its contract matters as much as a real vendor's: exactly one
 * `stop`, always last, with `usage` before it.
 */
function request(text: string, overrides?: Partial<CompletionRequest>): CompletionRequest {
  return {
    model: "echo",
    system: "You are a test.",
    messages: [{ role: "user", content: [{ type: "text", text }] }],
    tools: [{ name: "desktop_click", description: "Click", inputSchema: {} }],
    maxTokens: 1024,
    ...overrides,
  };
}

async function collect(req: CompletionRequest): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of new MockAdapter().stream(req)) events.push(event);
  return events;
}

function text(events: StreamEvent[]): string {
  return events
    .filter((e): e is { type: "text"; text: string } => e.type === "text")
    .map((e) => e.text)
    .join("");
}

describe("MockAdapter", () => {
  it("streams text in chunks and ends with usage then stop", async () => {
    const events = await collect(request("hello there"));

    expect(events.filter((e) => e.type === "stop")).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "stop", reason: "end" });
    expect(events.at(-2)?.type).toBe("usage");
    expect(events.filter((e) => e.type === "text").length).toBeGreaterThan(1);
    expect(text(events)).toContain("hello there");
  });

  it("emits a tool call for a /tool directive", async () => {
    const events = await collect(request('/tool desktop_click {"x":100,"y":240}'));

    const call = events.find((e) => e.type === "tool_call");
    expect(call).toEqual({
      type: "tool_call",
      id: expect.stringMatching(/^mock_/),
      name: "desktop_click",
      args: { x: 100, y: 240 },
    });
    expect(events.at(-1)).toEqual({ type: "stop", reason: "tool_use" });
  });

  it("still calls the tool when the directive has no arguments", async () => {
    const events = await collect(request("/tool desktop_screenshot"));
    expect(events.find((e) => e.type === "tool_call")).toMatchObject({
      name: "desktop_screenshot",
      args: {},
    });
  });

  it("stops after observing a tool result rather than looping forever", async () => {
    const events = await collect(
      request("/tool desktop_click {}", {
        messages: [
          { role: "user", content: [{ type: "text", text: "/tool desktop_click {}" }] },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                toolUseId: "mock_1",
                ok: true,
                text: "clicked",
                images: [],
              },
            ],
          },
        ],
      }),
    );

    expect(events.some((e) => e.type === "tool_call")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "stop", reason: "end" });
  });

  it("acts on a new instruction even after an earlier turn used a tool", async () => {
    const events = await collect(
      request("/tool desktop_screenshot", {
        messages: [
          { role: "user", content: [{ type: "text", text: "/tool desktop_click {}" }] },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                toolUseId: "mock_1",
                ok: true,
                text: "clicked",
                images: [],
              },
            ],
          },
          { role: "assistant", content: [{ type: "text", text: "Done." }] },
          { role: "user", content: [{ type: "text", text: "/tool desktop_screenshot" }] },
        ],
      }),
    );

    expect(events.find((e) => e.type === "tool_call")).toMatchObject({
      name: "desktop_screenshot",
    });
  });

  it("reports a refusal on /error", async () => {
    const events = await collect(request("/error"));
    expect(events.at(-1)).toEqual({ type: "stop", reason: "refusal" });
    expect(text(events)).toBe("");
  });

  it("reports usage so the ticker has something to show", async () => {
    const events = await collect(request("count my tokens"));
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toBeDefined();
    if (usage?.type !== "usage") throw new Error("unreachable");
    expect(usage.usage.in).toBeGreaterThan(0);
    expect(usage.usage.out).toBeGreaterThan(0);
  });

  it("stops promptly when the run is aborted", async () => {
    const controller = new AbortController();
    const events: StreamEvent[] = [];

    for await (const event of new MockAdapter().stream(
      request("a".repeat(400), { signal: controller.signal }),
    )) {
      events.push(event);
      if (events.length === 3) controller.abort();
    }

    expect(events.at(-1)).toEqual({ type: "stop", reason: "aborted" });
    // Exactly one terminal event, even on the abort path.
    expect(events.filter((e) => e.type === "stop")).toHaveLength(1);
  });
});
