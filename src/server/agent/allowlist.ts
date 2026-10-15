/**
 * Default tools offered to the model (ADR-06): about 50 of the 100 LHOS tools.
 * Every enabled tool's schema is sent with every model call, so the default
 * favours the reliable paths (structured browser, OCR, files, API) and leaves
 * RDP and the raw click family opt-in. Names must match the live catalog
 * (docs/MCP_REFERENCE.md); tests/unit/tool-categories.test.ts enforces it.
 *
 * The agent can still *name* a tool that is not here — the guard rejects it —
 * but the model will not see its schema, so it should not try.
 */
export const DEFAULT_TOOL_ALLOWLIST: readonly string[] = [
  // Observe & vision
  "observe",
  "desktop_screenshot",
  "screen_text",
  "read_text",
  "find_text",
  "wait_for_text",
  "read_image",
  "list_windows",
  "desktop_screen_size",
  "computer_info",
  "capabilities",
  // Computer control (no raw click family)
  "desktop_type",
  "desktop_key",
  "desktop_scroll",
  "desktop_move_mouse",
  "wait",
  // Browser (structured)
  "browser_start",
  "browser_goto",
  "browser_nav",
  "browser_click",
  "browser_fill",
  "browser_fill_form",
  "browser_press",
  "browser_scroll",
  "browser_wait",
  "browser_snapshot",
  "browser_text",
  "browser_links",
  "browser_extract",
  "browser_screenshot",
  "browser_tabs",
  "browser_new_tab",
  "browser_switch_tab",
  // Shell, code & files
  "run_command",
  "run_python",
  "list_files",
  "save_text",
  "save_csv",
  "share_file",
  // API plane
  "http_request",
  "connector_list",
  // Workflows & scheduling (read / run only; creating is owner-only)
  "workflow_list",
  "workflow_get",
  "workflow_run",
  "workflow_run_saved",
  "schedule_list",
  // Human-in-the-loop
  "ask_user",
  "request_takeover",
  "hitl_check",
  // Ops
  "set_pace",
  "session_report",
];

export function filterTools<T extends { name: string }>(
  tools: readonly T[],
  allowlist: readonly string[] = DEFAULT_TOOL_ALLOWLIST,
): T[] {
  const allowed = new Set(allowlist);
  return tools.filter((t) => allowed.has(t.name));
}

/**
 * Effective allowlist from Settings → Agent. Absent means "never customised"
 * and yields the ADR-06 default; an explicit list (even empty) is honoured.
 */
export function resolveAllowlist(setting: readonly string[] | undefined): readonly string[] {
  return setting ?? DEFAULT_TOOL_ALLOWLIST;
}
