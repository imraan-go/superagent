/**
 * "Full computer operator" (2026-10 parity work): every tool the owner's own
 * Claude-over-MCP sessions of 2026-10-14/15 actually used (logs/events in
 * e2b-agent-vm) plus the rest of the GUI/RDP families those tasks need, minus
 * anything locked by the guard. Names must match the live catalog
 * (docs/MCP_REFERENCE.md); tests/unit/tool-categories.test.ts enforces it.
 */
export const OPERATOR_TOOLS: readonly string[] = [
  // Observe & vision
  "observe", "desktop_screenshot", "screen_text", "read_text", "find_text", "wait_for_text",
  "read_image", "list_windows", "desktop_screen_size", "desktop_cursor", "computer_info", "capabilities",
  // Computer control (raw GUI family included: RDP is driven through it)
  "desktop_click", "desktop_double_click", "desktop_right_click", "desktop_move_mouse",
  "desktop_scroll", "desktop_key", "desktop_type", "desktop_batch", "click_text", "focus_window",
  "maximize_window", "desktop_launch", "desktop_open", "open_browser", "wait", "paste",
  "get_clipboard", "set_clipboard",
  // RDP / Windows
  "rdp_connect", "rdp_status", "rdp_disconnect", "rdp_open_url", "rdp_new_tab", "rdp_type",
  "rdp_hotkey", "rdp_fetch", "rdp_send", "rdp_profiles",
  // Browser (structured)
  "browser_start", "browser_goto", "browser_nav", "browser_click", "browser_fill", "browser_fill_form",
  "browser_press", "browser_scroll", "browser_wait", "browser_act", "browser_batch", "browser_snapshot",
  "browser_text", "browser_links", "browser_table", "browser_extract", "browser_screenshot",
  "browser_tabs", "browser_new_tab", "browser_switch_tab",
  // Shell, code & files
  "run_command", "run_python", "list_files", "save_text", "save_csv", "share_file", "drive_upload",
  // API plane
  "http_request", "connector_list",
  // Workflows (read / run only; creating is owner-only)
  "workflow_list", "workflow_get", "workflow_run", "workflow_run_saved", "schedule_list",
  // Human-in-the-loop
  "ask_user", "request_takeover", "hitl_check",
  // Ops (read-only)
  "set_pace", "session_report", "snapshot_list", "maintenance_status",
];

/** Operator tools left out of the default: rarely needed, and each schema costs tokens every call. */
const NOT_IN_DEFAULT = new Set([
  "desktop_right_click", "desktop_cursor", "maximize_window", "desktop_launch", "desktop_open",
  "open_browser", "paste", "get_clipboard", "set_clipboard", "browser_act", "browser_batch",
  "browser_table", "drive_upload", "snapshot_list", "maintenance_status",
]);

/**
 * Default tools offered to the model (ADR-06, revised 2026-10 for operator
 * parity): the operator set minus a few rarely used tools. The raw click
 * family and RDP are now in, because real Windows/RDP work (click_text,
 * rdp_type, desktop_click, wait) cannot be done without them. Approval
 * checkpoints (policy.ts) and locked tools (guard.ts) are unaffected.
 *
 * The agent can still *name* a tool that is not here — the guard rejects it —
 * but the model will not see its schema, so it should not try.
 */
export const DEFAULT_TOOL_ALLOWLIST: readonly string[] = OPERATOR_TOOLS.filter(
  (n) => !NOT_IN_DEFAULT.has(n),
);

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
