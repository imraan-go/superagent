/**
 * Human phrasing for one completed (or running) tool step in the run trace.
 * Pure module — no React — so it is unit-tested directly.
 *
 * Where `activityLabel` (src/lib/activity.ts) speaks in the present tense for
 * the live line, this speaks in the past tense for the audit trail and can use
 * the call's arguments ("Ran `ls ~/persist`").
 */

export type ToolCategory =
  | "screen"
  | "browser"
  | "shell"
  | "rdp"
  | "files"
  | "connector"
  | "mcp"
  | "memory"
  | "schedule"
  | "human"
  | "other";

export const CATEGORY_NOUN: Record<ToolCategory, string> = {
  screen: "the computer",
  browser: "the browser",
  shell: "the shell",
  rdp: "your Windows PC",
  files: "files",
  connector: "connectors",
  mcp: "MCP servers",
  memory: "memory",
  schedule: "schedules",
  human: "you",
  other: "tools",
};

export function toolCategory(name: string | null | undefined): ToolCategory {
  if (!name) return "other";
  if (name.startsWith("mcp__")) return "mcp";
  if (name.startsWith("composio__") || name.startsWith("pipedream__")) return "connector";
  if (name.startsWith("rdp_")) return "rdp";
  if (name.startsWith("browser_") || name === "open_browser") return "browser";
  if (name === "run_command" || name === "run_python") return "shell";
  if (name.startsWith("schedule_") || name.startsWith("workflow_") || name === "trigger_url") return "schedule";
  if (name.startsWith("memory_") || name.includes("memory")) return "memory";
  if (["ask_user", "hitl_check", "request_takeover"].includes(name)) return "human";
  if (
    name.startsWith("file_") ||
    name.startsWith("fs_") ||
    ["list_files", "save_text", "save_csv", "share_file", "drive_upload", "read_text", "read_image"].includes(name)
  ) {
    return "files";
  }
  if (name === "http_request" || name.startsWith("connector_") || name.startsWith("api_")) return "connector";
  if (
    name.startsWith("desktop_") ||
    ["observe", "screen_text", "find_text", "click_text", "wait_for_text", "list_windows", "focus_window",
      "maximize_window", "computer_info", "paste", "get_clipboard", "set_clipboard", "wait", "set_pace"].includes(name)
  ) {
    return "screen";
  }
  return "other";
}

const PAST: Record<string, string> = {
  desktop_screenshot: "Looked at the screen",
  observe: "Looked at the screen",
  screen_text: "Read the screen",
  find_text: "Searched the screen",
  desktop_click: "Clicked",
  click_text: "Clicked",
  desktop_double_click: "Double-clicked",
  desktop_right_click: "Opened a context menu",
  desktop_type: "Typed text",
  desktop_key: "Pressed keys",
  desktop_scroll: "Scrolled",
  desktop_move_mouse: "Moved the mouse",
  desktop_batch: "Ran a desktop sequence",
  list_windows: "Listed open windows",
  focus_window: "Focused a window",
  maximize_window: "Maximised a window",
  wait: "Waited",
  wait_for_text: "Waited for text on screen",
  set_pace: "Adjusted its pace",
  computer_info: "Checked the computer",
  browser_screenshot: "Captured the page",
  browser_text: "Read the page",
  browser_snapshot: "Read the page structure",
  browser_click: "Clicked in the browser",
  browser_fill: "Filled a field",
  browser_fill_form: "Filled a form",
  browser_extract: "Extracted page data",
  browser_table: "Read a table",
  browser_links: "Collected links",
  rdp_status: "Checked the Windows link",
  rdp_connect: "Connected to your Windows PC",
  rdp_disconnect: "Disconnected from your Windows PC",
  rdp_type: "Typed on your Windows PC",
  rdp_hotkey: "Pressed keys on your Windows PC",
  rdp_fetch: "Pulled a file from your Windows PC",
  rdp_send: "Sent a file to your Windows PC",
  rdp_profiles: "Listed RDP profiles",
  list_files: "Listed files",
  save_text: "Saved a file",
  save_csv: "Saved a CSV",
  share_file: "Shared a file",
  read_text: "Read a file",
  read_image: "Viewed an image",
  ask_user: "Asked you a question",
  hitl_check: "Asked for your approval",
  request_takeover: "Asked you to take over",
  schedule_create: "Created a schedule",
  schedule_list: "Listed schedules",
  schedule_delete: "Deleted a schedule",
  schedule_run_now: "Ran a schedule",
  connector_list: "Listed connectors",
  pipedream__emit: "Sent a Pipedream event",
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function clip(s: string, n = 48): string {
  const flat = s.replace(/\s+/g, " ");
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
}

function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return clip(url, 40);
  }
}

/** "notion_create_page" → "create page"; "notion" → "Notion". */
function words(s: string): string {
  return s.replace(/_/g, " ").trim();
}
function titleCase(s: string): string {
  return words(s).replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Past-tense, human title. Inline code is marked with backticks; the renderer
 * turns them into `<code>`.
 */
export function toolTitle(name: string | null | undefined, args?: Record<string, unknown> | null): string {
  if (!name) return "Thought it through";
  const a = args ?? {};

  if (name.startsWith("mcp__") || name.startsWith("composio__")) {
    const [ns, group, action] = name.split("__");
    const via = ns === "mcp" ? " via MCP" : "";
    return `Called ${titleCase(group ?? "")}${action ? ` · ${words(action)}` : ""}${via}`;
  }

  if (name === "run_command") {
    const cmd = str(a.command) ?? str(a.cmd);
    return cmd ? `Ran \`${clip(cmd)}\`` : "Ran a shell command";
  }
  if (name === "run_python") return "Ran a Python script";

  if (name === "browser_goto" || name === "open_browser" || name === "rdp_open_url" || name === "browser_new_tab") {
    const url = str(a.url);
    const where = name === "rdp_open_url" ? " on your Windows PC" : "";
    return url ? `Opened ${host(url)}${where}` : `Opened a page${where}`;
  }
  if (name === "http_request") {
    const url = str(a.url);
    const method = (str(a.method) ?? "GET").toUpperCase();
    return url ? `${method} ${host(url)}` : "Made an HTTP request";
  }
  if (name === "desktop_type" || name === "rdp_type") {
    const text = str(a.text);
    const where = name === "rdp_type" ? " on your Windows PC" : "";
    return text ? `Typed “${clip(text, 32)}”${where}` : `Typed text${where}`;
  }
  if (name === "click_text" || name === "find_text" || name === "wait_for_text") {
    const text = str(a.text) ?? str(a.query);
    if (text) return `${PAST[name]} “${clip(text, 32)}”`;
  }
  if (name === "desktop_launch" || name === "desktop_open") {
    const what = str(a.app) ?? str(a.command) ?? str(a.path) ?? str(a.target);
    return what ? `Launched ${clip(what, 32)}` : "Launched an app";
  }

  const exact = PAST[name];
  if (exact) return exact;

  const cat = toolCategory(name);
  const action = words(name.replace(/^(desktop|browser|rdp|schedule|workflow|memory|file|fs)_/, ""));
  switch (cat) {
    case "browser":
      return `Browser · ${action}`;
    case "rdp":
      return `Windows PC · ${action}`;
    case "screen":
      return `Desktop · ${action}`;
    default:
      return action.charAt(0).toUpperCase() + action.slice(1);
  }
}

/** "6.2s", "840ms", "1m 04s" — mono readouts. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** One-line summary of a finished trace: "Used the computer · 3 steps · 6.2s". */
export function traceSummary(steps: ReadonlyArray<{ toolName: string | null; ms: number | null }>): string {
  const tools = steps.filter((s) => s.toolName);
  if (tools.length === 0) return "Thought it through";

  const counts = new Map<ToolCategory, number>();
  for (const s of tools) {
    const c = toolCategory(s.toolName);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([c]) => c);
  const nouns = ranked.slice(0, 2).map((c) => CATEGORY_NOUN[c]);
  const verb = ranked[0] === "human" ? "Checked with" : "Used";
  const total = tools.reduce((n, s) => n + (s.ms ?? 0), 0);
  const parts = [`${verb} ${nouns.join(" and ")}`, `${tools.length} step${tools.length === 1 ? "" : "s"}`];
  if (total > 0) parts.push(formatMs(total));
  return parts.join(" · ");
}
