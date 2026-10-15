import { beforeAll, describe, expect, it } from "vitest";

/**
 * Opt-in smoke test against the real agent server:
 *
 *   LHOS_LIVE=1 npm run test:smoke
 *
 * Excluded from the default unit run (vitest.config.mts) because the unit
 * suite must stay offline and deterministic. This exists because the tool
 * envelope is the one contract we cannot verify from the type system — if LHOS
 * changes shape, the agent loop breaks at runtime and nowhere else.
 *
 * Only read-only tools are called. Nothing here clicks, types, posts, or
 * decides an approval.
 */
const live = process.env.LHOS_LIVE === "1";
const describeLive = live ? describe : describe.skip;

describeLive("LHOS live contract", () => {
  let lhos: typeof import("@/server/lhos/client")["lhos"];
  let resultText: typeof import("@/server/lhos/client")["resultText"];
  let resultImages: typeof import("@/server/lhos/client")["resultImages"];

  beforeAll(async () => {
    const mod = await import("@/server/lhos/client");
    lhos = mod.lhos;
    resultText = mod.resultText;
    resultImages = mod.resultImages;
  });

  it("lists the full tool catalogue", async () => {
    const tools = await lhos.getTools();
    expect(tools.length).toBeGreaterThan(50);
    expect(tools.map((t) => t.name)).toContain("desktop_screenshot");
    // Every tool must carry a usable JSON Schema or the model cannot call it.
    for (const tool of tools) {
      expect(typeof tool.input_schema).toBe("object");
    }
  });

  it("executes a read-only tool and parses the envelope", async () => {
    const res = await lhos.callTool("desktop_cursor", {});
    expect(res.ok).toBe(true);
    expect(res.tool).toBe("desktop_cursor");
    expect(res.ms).toBeGreaterThanOrEqual(0);
    expect(resultText(res.result)).toBeTypeOf("string");
  });

  it("returns image blocks as base64, never as a URL", async () => {
    const res = await lhos.callTool("desktop_screenshot", { quality: 40 });
    const images = resultImages(res.result);
    expect(images.length).toBeGreaterThan(0);
    expect(images[0]?.mime).toMatch(/^image\//);
    expect(images[0]?.data_b64.length).toBeGreaterThan(100);
  });

  it("surfaces an unknown tool as a fatal error, not a retry", async () => {
    await expect(lhos.callTool("definitely_not_a_tool", {})).rejects.toMatchObject({
      retryable: false,
    });
  });

  it("reads capabilities and pending approvals", async () => {
    const capabilities = await lhos.getCapabilities();
    expect(capabilities.desktop).toBeDefined();

    const pending = await lhos.getPendingApprovals();
    for (const item of pending) {
      expect(item.id).toMatch(/^[0-9a-f]{8}$/);
      expect(["confirm", "ask", "takeover"]).toContain(item.kind);
    }
  });
});
