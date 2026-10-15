/**
 * Default tools offered to the model (ADR-06). All 100 schemas are ~11k tokens
 * and dilute attention; RDP and the raw click-family stay opt-in until the
 * owner enables them in Settings → Agent.
 *
 * The agent can still *name* a tool that is not here — the LHOS client will
 * reject it — but the model will not see its schema, so it should not try.
 */
export const DEFAULT_TOOL_ALLOWLIST: readonly string[] = [
  "desktop_screenshot",
  "screen_text",
  "desktop_type",
  "desktop_key",
  "desktop_scroll",
  "desktop_wait",
  "desktop_move_mouse",
  "wait",
  "set_pace",
  "hitl_check",
  "ask_user",
  "request_takeover",
  "browser_open",
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_press",
  "file_read",
  "file_write",
  "file_list",
  "fs_read",
  "fs_write",
  "fs_ls",
  "shell_exec",
  "shell_run",
];

export function filterTools<T extends { name: string }>(
  tools: readonly T[],
  allowlist: readonly string[] = DEFAULT_TOOL_ALLOWLIST,
): T[] {
  const allowed = new Set(allowlist);
  return tools.filter((t) => allowed.has(t.name));
}
