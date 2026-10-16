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
  screen: "the workspace",
  browser: "the browser",
  shell: "Python",
  rdp: "a remote PC",
  files: "files",
  connector: "your apps",
  mcp: "tools",
  memory: "memory",
  schedule: "routines",
  human: "you",
  other: "tools",
};

const CONNECTED_TOOLKITS = /^(gmail|github|googlecalendar|googledrive|googledocs|googlesheets|notion|slack|outlook|linear|jira|calendar|drive)_/;

export function toolCategory(name: string | null | undefined): ToolCategory {
  if (!name) return "other";
  const n = name.toLowerCase();
  if (n.startsWith("browser_")) return "browser";
  if (n === "workspace_run_python") return "shell";
  if (n.startsWith("workspace_")) return "files";
  if (n.startsWith("schedule_")) return "schedule";
  if (n.startsWith("memory_")) return "memory";
  if (n === "ask_user") return "human";
  if (CONNECTED_TOOLKITS.test(n) || /^[a-z0-9]+_[a-z0-9_]+$/.test(n)) return "connector";
  return "other";
}

const PAST: Record<string, string> = {
  workspace_write_file: "Wrote a file",
  workspace_read_file: "Read a file",
  workspace_run_python: "Ran a Python script",
  workspace_export_file: "Exported a file",
  browser_read: "Read the page",
  browser_screenshot: "Captured the page",
  browser_click: "Clicked in the browser",
  browser_type: "Typed in the browser",
  browser_scroll: "Scrolled the page",
  browser_download: "Downloaded a file",
  browser_stop: "Closed the browser",
  memory_save: "Saved a memory",
  ask_user: "Asked you a question",
  schedule_create: "Created a routine",
  schedule_list: "Listed routines",
  schedule_pause: "Paused a routine",
  schedule_resume: "Resumed a routine",
  schedule_delete: "Deleted a routine",
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

/** "fetch_emails" → "fetch emails". */
function words(s: string): string {
  return s.replace(/_/g, " ").trim();
}
function titleCase(s: string): string {
  return words(s).replace(/\b\w/g, (c) => c.toUpperCase());
}

const TOOLKIT_NAME: Record<string, string> = {
  gmail: "Gmail",
  github: "GitHub",
  googlecalendar: "Google Calendar",
  googledrive: "Google Drive",
  notion: "Notion",
};

/**
 * Past-tense, human title. Inline code is marked with backticks; the renderer
 * turns them into `<code>`.
 */
export function toolTitle(name: string | null | undefined, args?: Record<string, unknown> | null): string {
  if (!name) return "Thought it through";
  const a = args ?? {};

  if (name === "browser_navigate" || name === "browser_download") {
    const url = str(a.url);
    const verb = name === "browser_navigate" ? "Opened" : "Downloaded from";
    return url ? `${verb} ${host(url)}` : PAST[name] ?? "Opened a page";
  }
  if (name === "workspace_write_file" || name === "workspace_read_file" || name === "workspace_export_file") {
    const path = str(a.path);
    if (path) return `${PAST[name]} \`${clip(path, 40)}\``;
  }
  if (name === "browser_type") {
    const text = str(a.text);
    if (text) return `Typed “${clip(text, 32)}” in the browser`;
  }
  if (name === "schedule_create") {
    const n = str(a.name);
    if (n) return `Created the routine “${clip(n, 40)}”`;
  }
  if (name === "memory_save") {
    const c = str(a.content);
    if (c) return `Remembered “${clip(c, 40)}”`;
  }

  const exact = PAST[name];
  if (exact) return exact;

  if (toolCategory(name) === "connector") {
    const [kit = "", ...rest] = name.split("_");
    return `${TOOLKIT_NAME[kit] ?? titleCase(kit)} · ${words(rest.join("_"))}`;
  }
  const action = words(name);
  return action.charAt(0).toUpperCase() + action.slice(1);
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
