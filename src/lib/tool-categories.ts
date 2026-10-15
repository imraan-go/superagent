/**
 * Tool categories for Settings -> Agent. Mirrors docs/MCP_REFERENCE.md; any
 * tool not listed (new LHOS tools, connector tools) lands in "Other".
 * Pure module: shared by the UI and its tests.
 */
export interface ToolCategory {
  id: string;
  label: string;
  /** One line shown under the category heading. */
  hint: string;
  tools: readonly string[];
}

export const TOOL_CATEGORIES: readonly ToolCategory[] = [
  {
    id: "observe",
    label: "Observe & vision",
    hint: "Look at the screen: OCR text, windows, screenshots.",
    tools: [
      "observe", "desktop_screenshot", "screen_text", "read_text", "find_text", "wait_for_text",
      "read_image", "list_windows", "desktop_screen_size", "desktop_cursor", "computer_info", "capabilities",
    ],
  },
  {
    id: "gui",
    label: "Computer control (GUI)",
    hint: "Mouse, keyboard and windows on the Linux desktop.",
    tools: [
      "desktop_click", "desktop_double_click", "desktop_right_click", "desktop_move_mouse",
      "desktop_scroll", "desktop_key", "desktop_type", "desktop_batch", "click_text", "focus_window",
      "maximize_window", "desktop_launch", "desktop_open", "open_browser", "wait", "paste",
      "get_clipboard", "set_clipboard",
    ],
  },
  {
    id: "browser",
    label: "Browser (structured)",
    hint: "Playwright on Linux Chrome. More reliable than clicking pixels.",
    tools: [
      "browser_start", "browser_goto", "browser_nav", "browser_click", "browser_fill", "browser_fill_form",
      "browser_press", "browser_hover", "browser_scroll", "browser_wait", "browser_act", "browser_batch",
      "browser_eval", "browser_snapshot", "browser_html", "browser_text", "browser_links", "browser_table",
      "browser_extract", "browser_attr", "browser_screenshot", "browser_tabs", "browser_new_tab",
      "browser_switch_tab", "browser_close_tab", "browser_download", "browser_upload",
    ],
  },
  {
    id: "rdp",
    label: "RDP / Windows",
    hint: "Drive your Windows machine over RDP. Opt-in.",
    tools: [
      "rdp_connect", "rdp_status", "rdp_disconnect", "rdp_open_url", "rdp_new_tab", "rdp_type",
      "rdp_hotkey", "rdp_fetch", "rdp_send", "rdp_profiles",
    ],
  },
  {
    id: "shell",
    label: "Shell, code & files",
    hint: "Run commands and Python, save files, share downloads.",
    tools: ["run_command", "run_python", "list_files", "save_text", "save_csv", "share_file", "drive_upload"],
  },
  {
    id: "api",
    label: "API plane",
    hint: "Direct REST calls with vault-injected auth, and connectors.",
    tools: ["http_request", "secret_list", "secret_delete", "secret_intake_url", "connector_list", "connector_save"],
  },
  {
    id: "workflows",
    label: "Workflows & scheduling",
    hint: "Run saved workflows and schedules. Creating them is done by you in Settings.",
    tools: [
      "workflow_run", "workflow_save", "workflow_list", "workflow_get", "workflow_run_saved",
      "schedule_create", "schedule_list", "schedule_enable", "schedule_delete", "schedule_run_now", "trigger_url",
    ],
  },
  {
    id: "hitl",
    label: "Human-in-the-loop",
    hint: "Ask you a question or hand over the screen.",
    tools: ["ask_user", "request_takeover", "hitl_check"],
  },
  {
    id: "ops",
    label: "Ops & maintenance",
    hint: "Pace, session reports, snapshots, maintenance.",
    tools: ["session_report", "maintenance_status", "maintenance_run_now", "snapshot_list", "snapshot_prune", "set_pace"],
  },
];

export const OTHER_CATEGORY: ToolCategory = {
  id: "other",
  label: "Other",
  hint: "Tools that are not in the reference list yet.",
  tools: [],
};

const BY_TOOL = new Map<string, string>(
  TOOL_CATEGORIES.flatMap((c) => c.tools.map((t) => [t, c.id] as const)),
);

export function categoryIdOf(toolName: string): string {
  return BY_TOOL.get(toolName) ?? OTHER_CATEGORY.id;
}

export interface CategoryGroup<T extends { name: string }> {
  category: ToolCategory;
  tools: T[];
}

/** Groups tools in category order; empty categories are omitted. */
export function groupByCategory<T extends { name: string }>(tools: readonly T[]): CategoryGroup<T>[] {
  const all = [...TOOL_CATEGORIES, OTHER_CATEGORY];
  const buckets = new Map<string, T[]>(all.map((c) => [c.id, []]));
  for (const t of tools) buckets.get(categoryIdOf(t.name))!.push(t);
  return all
    .map((category) => ({
      category,
      tools: buckets.get(category.id)!.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.tools.length > 0);
}
