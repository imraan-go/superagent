import { describe, expect, it } from "vitest";
import {
  approvalListSchema,
  capabilitiesSchema,
  eventListSchema,
  toolCatalogSchema,
  toolResultSchema,
} from "@/server/lhos/types";

/**
 * Fixtures captured verbatim from the live LHOS server on 2026-10-15. If the
 * agent server ever changes shape, these fail before the agent loop does.
 */
describe("tool execution envelope", () => {
  it("parses a text result", () => {
    const parsed = toolResultSchema.parse({
      ok: true,
      tool: "screen_text",
      ms: 428,
      result: [{ type: "text", text: "Firefox — Mozilla" }],
    });
    expect(parsed.ms).toBe(428);
    expect(parsed.result[0]).toEqual({ type: "text", text: "Firefox — Mozilla" });
  });

  it("parses image blocks with base64 payloads", () => {
    const parsed = toolResultSchema.parse({
      ok: true,
      tool: "desktop_screenshot",
      ms: 346,
      result: [{ type: "image", mime: "image/png", data_b64: "iVBORw0KGgo=" }],
    });
    expect(parsed.result[0]).toMatchObject({ type: "image", mime: "image/png" });
  });

  it("accepts an unrecognised block type rather than failing the run", () => {
    const parsed = toolResultSchema.parse({
      ok: true,
      tool: "weird",
      ms: 1,
      result: [{ type: "EmbeddedResource", data: "…" }],
    });
    expect(parsed.result).toHaveLength(1);
  });

  it("rejects a response that is missing the envelope", () => {
    expect(() => toolResultSchema.parse({ text: "raw result" })).toThrow();
  });
});

describe("tool catalogue", () => {
  it("parses catalogue entries", () => {
    const parsed = toolCatalogSchema.parse([
      {
        name: "hitl_check",
        description: "Check the human's answer.",
        input_schema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    ]);
    expect(parsed[0]?.name).toBe("hitl_check");
  });

  it("tolerates a null description", () => {
    const parsed = toolCatalogSchema.parse([
      { name: "wait", description: null, input_schema: {} },
    ]);
    expect(parsed[0]?.description).toBe("");
  });
});

describe("capabilities", () => {
  it("parses the live snapshot and keeps unknown keys", () => {
    const parsed = capabilitiesSchema.parse({
      desktop: { up: true, sandbox_id: "injo6euds4sckm4toz579" },
      linux_browser: { devtools_running: true },
      rdp: {
        connected: false,
        profile: "next-com-se",
        shared_drive: false,
        password_stored: false,
        profiles: ["next-com-se"],
      },
      api: { credentials: [], connectors: [] },
      skills: [{ name: "heartbeat", site: "", params: [], runs: 0, ok: 0 }],
      windows_agents: "not available yet",
      pace: { mode: "fast", min_gap_s: 4.0, max_per_hour: 60 },
      pending_human_requests: 2,
    });

    expect(parsed.desktop?.up).toBe(true);
    expect(parsed.pace?.mode).toBe("fast");
    expect(parsed.pending_human_requests).toBe(2);
    // Unknown fields survive so Manage mode can surface them later.
    expect(parsed["windows_agents"]).toBe("not available yet");
  });
});

describe("approvals", () => {
  it("parses all three HITL kinds", () => {
    const parsed = approvalListSchema.parse([
      { id: "8294cee7", kind: "takeover", prompt: "RDP client installed…", created: 1791902546.5 },
      { id: "dba3a6dd", kind: "confirm", prompt: "About to post", created: 1791902718.6 },
      { id: "aa11bb22", kind: "ask", prompt: "Which account?", created: 1791902900.1 },
    ]);
    expect(parsed.map((a) => a.kind)).toEqual(["takeover", "confirm", "ask"]);
  });

  it("falls back to confirm for an unknown kind", () => {
    const [first] = approvalListSchema.parse([
      { id: "ffffffff", kind: "something-new", prompt: "?", created: 1 },
    ]);
    expect(first?.kind).toBe("confirm");
  });
});

describe("events", () => {
  it("parses the live event shape", () => {
    const parsed = eventListSchema.parse([
      {
        ts: 1792041120.421,
        iso: "2026-10-15T05:12:00Z",
        tool: "desktop_screenshot",
        ms: 428,
        ok: true,
        err: null,
        images: 1,
        client: "160.79.106.168",
        via: "mcp",
      },
    ]);
    expect(parsed[0]?.tool).toBe("desktop_screenshot");
    expect(parsed[0]?.images).toBe(1);
  });
});
