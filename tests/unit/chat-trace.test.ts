import { describe, expect, it } from "vitest";
import { formatMs, toolCategory, toolTitle, traceSummary } from "@/components/chat/parts/tool-meta";
import { groupExchanges, liveTrace } from "@/components/chat/parts/exchanges";
import type { ChatMessage } from "@/lib/messages";

describe("tool-meta", () => {
  it("categorises tools", () => {
    expect(toolCategory("desktop_screenshot")).toBe("screen");
    expect(toolCategory("browser_goto")).toBe("browser");
    expect(toolCategory("run_command")).toBe("shell");
    expect(toolCategory("rdp_type")).toBe("rdp");
    expect(toolCategory("mcp__notion__create_page")).toBe("mcp");
    expect(toolCategory("composio__gmail__send")).toBe("connector");
    expect(toolCategory("list_files")).toBe("files");
  });

  it("writes human titles from args", () => {
    expect(toolTitle("desktop_screenshot")).toBe("Looked at the screen");
    expect(toolTitle("run_command", { command: "ls ~/persist" })).toBe("Ran `ls ~/persist`");
    expect(toolTitle("mcp__notion__create_page", {})).toBe("Called Notion · create page via MCP");
    expect(toolTitle("browser_goto", { url: "https://www.linkedin.com/feed" })).toBe("Opened linkedin.com");
  });

  it("summarises a trace", () => {
    expect(
      traceSummary([
        { toolName: "desktop_screenshot", ms: 2000 },
        { toolName: "desktop_click", ms: 1200 },
        { toolName: "desktop_screenshot", ms: 3000 },
      ]),
    ).toBe("Used the computer · 3 steps · 6.2s");
    expect(formatMs(840)).toBe("840ms");
  });
});

const base = { model: "m", runId: "r1", createdAt: "2026-10-15T00:00:00Z" };

describe("groupExchanges", () => {
  it("pairs tool calls with results and keeps the final answer", () => {
    const msgs: ChatMessage[] = [
      { ...base, id: "u", role: "user", runId: null, content: [{ type: "text", text: "hi" }] },
      {
        ...base,
        id: "a1",
        role: "assistant",
        content: [
          { type: "text", text: "Let me look." },
          { type: "tool_use", id: "t1", name: "desktop_screenshot", args: {} },
        ],
      },
      {
        ...base,
        id: "tr",
        role: "tool",
        content: [{ type: "tool_result", toolUseId: "t1", name: "desktop_screenshot", ok: true, ms: 900, text: "ok", images: [] }],
      },
      { ...base, id: "a2", role: "assistant", content: [{ type: "text", text: "Done." }] },
    ];
    const [ex] = groupExchanges(msgs);
    expect(ex?.answer).toBe("Done.");
    expect(ex?.trace.map((t) => t.kind)).toEqual(["thought", "tool"]);
    expect(ex?.trace[1]?.ms).toBe(900);

    const live = liveTrace(
      [{ idx: 0, type: "tool", toolName: "desktop_screenshot", label: "x", ok: null, ms: null }],
      ex!.trace,
    );
    expect(live.map((t) => t.kind)).toEqual(["thought", "tool"]);
    expect(live[1]?.args).toEqual({});

    const ahead = liveTrace(
      [
        { idx: 0, type: "tool", toolName: "desktop_screenshot", label: "x", ok: true, ms: 900 },
        { idx: 1, type: "tool", toolName: "run_command", label: "y", ok: null, ms: null },
      ],
      ex!.trace,
    );
    expect(ahead.at(-1)?.toolName).toBe("run_command");
    expect(ahead.at(-1)?.ok).toBeNull();
  });
});
