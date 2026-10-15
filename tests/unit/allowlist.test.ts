import { describe, expect, it } from "vitest";
import { DEFAULT_TOOL_ALLOWLIST, OPERATOR_TOOLS, filterTools } from "@/server/agent/allowlist";
import { lockedToolReason } from "@/server/agent/guard";

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
    expect(kept.map((t) => t.name)).toEqual(["desktop_screenshot", "desktop_click", "rdp_connect", "set_pace"]);
  });

  it("includes the operator essentials by default (2026-10 parity)", () => {
    for (const n of ["desktop_click", "click_text", "wait", "desktop_scroll", "rdp_connect", "rdp_type", "rdp_open_url"]) {
      expect(DEFAULT_TOOL_ALLOWLIST).toContain(n);
    }
  });

  it("default is a subset of the operator preset and has no locked tools", () => {
    expect(DEFAULT_TOOL_ALLOWLIST.every((n) => OPERATOR_TOOLS.includes(n))).toBe(true);
    expect(DEFAULT_TOOL_ALLOWLIST.filter((n) => lockedToolReason(n) !== null)).toEqual([]);
    expect(OPERATOR_TOOLS.filter((n) => lockedToolReason(n) !== null)).toEqual([]);
  });
});
