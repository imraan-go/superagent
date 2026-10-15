import { describe, expect, it } from "vitest";
import { DEFAULT_TOOL_ALLOWLIST, filterTools } from "@/server/agent/allowlist";

describe("filterTools", () => {
  it("keeps only named tools", () => {
    const kept = filterTools(
      [
        { name: "desktop_screenshot" },
        { name: "desktop_click" },
        { name: "rdp_connect" },
        { name: "set_pace" },
      ],
    );
    expect(kept.map((t) => t.name)).toEqual(["desktop_screenshot", "set_pace"]);
  });

  it("does not include the raw click family or RDP by default", () => {
    expect(DEFAULT_TOOL_ALLOWLIST).not.toContain("desktop_click");
    expect(DEFAULT_TOOL_ALLOWLIST.some((n) => n.startsWith("rdp_"))).toBe(false);
  });
});
