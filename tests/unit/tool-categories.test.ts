import { describe, expect, it } from "vitest";
import names from "../fixtures/lhos-tool-names.json";
import { DEFAULT_TOOL_ALLOWLIST } from "@/server/agent/allowlist";
import { blockedToolReason, lockedToolReason } from "@/server/agent/guard";
import { OTHER_CATEGORY, TOOL_CATEGORIES, categoryIdOf, groupByCategory } from "@/lib/tool-categories";
import {
  PRESETS,
  computePreset,
  estimateSchemaTokens,
  isLocked,
  matchingPreset,
  needsApproval,
  sanitizeSelection,
  shortDescription,
  toggleNames,
} from "@/lib/tool-allowlist";

// Snapshot of GET /api/tools from docs/MCP_REFERENCE.md (100 names).
const ALL: string[] = names;

describe("tool categories", () => {
  it("fixture has the 100 live tools", () => {
    expect(ALL).toHaveLength(100);
    expect(new Set(ALL).size).toBe(100);
  });

  it("every live tool lands in a real category (none fall to Other)", () => {
    const stray = ALL.filter((n) => categoryIdOf(n) === OTHER_CATEGORY.id);
    expect(stray).toEqual([]);
  });

  it("a tool is listed in exactly one category and all listed tools are real", () => {
    const listed = TOOL_CATEGORIES.flatMap((c) => c.tools);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.filter((n) => !ALL.includes(n))).toEqual([]);
  });

  it("unknown tools go to Other, in category order", () => {
    const groups = groupByCategory([{ name: "mystery_tool" }, { name: "rdp_type" }, { name: "observe" }]);
    expect(groups.map((g) => g.category.id)).toEqual(["observe", "rdp", "other"]);
  });

  it("the default allowlist only names real tools", () => {
    expect(DEFAULT_TOOL_ALLOWLIST.filter((n) => !ALL.includes(n))).toEqual([]);
  });
});

describe("locked tools", () => {
  const locked = ALL.filter(isLocked);

  it("matches the guard deny-list exactly", () => {
    expect(locked.sort()).toEqual(
      [
        "connector_save", "maintenance_run_now", "snapshot_prune", "schedule_create", "schedule_delete", "schedule_enable", "secret_delete",
        "secret_intake_url", "secret_list", "trigger_url", "workflow_save",
      ].sort(),
    );
    for (const n of locked) {
      expect(lockedToolReason(n)).toBeTruthy();
      expect(blockedToolReason(n, new Set([n]))).not.toBeNull();
    }
  });

  it("is never part of the default or any preset", () => {
    expect(DEFAULT_TOOL_ALLOWLIST.filter(isLocked)).toEqual([]);
    for (const p of PRESETS) expect(computePreset(p.id, ALL).filter(isLocked)).toEqual([]);
  });

  it("enable-all never toggles a locked tool; disable-all leaves selection valid", () => {
    const on = toggleNames(new Set(), ALL, true);
    expect([...on].filter(isLocked)).toEqual([]);
    expect(on.size).toBe(ALL.length - locked.length);
    expect(toggleNames(on, ALL, false).size).toBe(0);
  });

  it("sanitizeSelection drops locked and unknown names", () => {
    expect(sanitizeSelection(["observe", "trigger_url", "fs_read", "observe"], ALL)).toEqual(["observe"]);
  });
});

describe("presets", () => {
  it("recommended equals the default list", () => {
    expect(computePreset("recommended", ALL)).toEqual([...DEFAULT_TOOL_ALLOWLIST].sort());
  });

  it("everything = all non-locked", () => {
    expect(computePreset("everything", ALL)).toHaveLength(ALL.filter((n) => !isLocked(n)).length);
  });

  it("rdp = recommended + all rdp tools", () => {
    const rdp = computePreset("rdp", ALL);
    const rdpTools = TOOL_CATEGORIES.find((c) => c.id === "rdp")!.tools;
    expect(rdpTools.every((n) => rdp.includes(n))).toBe(true);
    expect(computePreset("recommended", ALL).every((n) => rdp.includes(n))).toBe(true);
    expect(rdp).toHaveLength(new Set([...computePreset("recommended", ALL), ...rdpTools]).size);
  });

  it("operator = every tool of the 2026-10-14/15 MCP sessions that is not locked", () => {
    const op = computePreset("operator", ALL);
    // Real usage from e2b-agent-vm logs/events (unlocked tools only).
    for (const n of [
      "desktop_screenshot", "wait", "desktop_click", "rdp_open_url", "desktop_scroll", "run_command",
      "observe", "desktop_key", "list_files", "rdp_type", "screen_text", "click_text", "browser_fill",
      "rdp_connect", "workflow_run_saved", "workflow_run", "workflow_list", "set_pace", "share_file",
      "http_request", "schedule_list", "snapshot_list", "maintenance_status", "rdp_status", "rdp_profiles",
      "rdp_hotkey", "rdp_fetch", "rdp_send", "desktop_type", "desktop_move_mouse", "desktop_cursor",
      "session_report", "hitl_check", "save_text", "capabilities", "browser_goto", "browser_snapshot",
    ]) {
      expect(op, n).toContain(n);
    }
    expect(op.filter(isLocked)).toEqual([]);
    expect(op).not.toContain("trigger_url");
    expect(op).not.toContain("secret_list");
    expect(computePreset("recommended", ALL).every((n) => op.includes(n))).toBe(true);
    expect(matchingPreset(new Set(op), ALL)).toBe("operator");
  });

  it("browser only has browser, observe and hitl tools", () => {
    const b = computePreset("browser", ALL);
    expect(b.every((n) => ["browser", "observe", "hitl"].includes(categoryIdOf(n)))).toBe(true);
    expect(b).toContain("browser_goto");
    expect(b).not.toContain("run_command");
  });

  it("matchingPreset identifies the active preset", () => {
    expect(matchingPreset(new Set(computePreset("browser", ALL)), ALL)).toBe("browser");
    expect(matchingPreset(new Set(["observe"]), ALL)).toBeNull();
  });
});

describe("badges and estimates", () => {
  it("flags approval-gated tools", () => {
    expect(needsApproval("rdp_send")).toBe(true);
    expect(needsApproval("share_file")).toBe(true);
    expect(needsApproval("http_request")).toBe(true);
    expect(needsApproval("screen_text")).toBe(false);
  });

  it("estimates tokens as chars / 4", () => {
    expect(estimateSchemaTokens([400, 600])).toBe(250);
    expect(estimateSchemaTokens([])).toBe(0);
  });

  it("trims descriptions to one short sentence", () => {
    expect(shortDescription("Take a screenshot. Returns a PNG.\nMore.")).toBe("Take a screenshot.");
    expect(shortDescription("x".repeat(300), 20)).toHaveLength(20);
  });
});
