/**
 * Human phrasing for what the agent is doing right now (DESIGN_SYSTEM
 * §Signature elements → Activity line).
 *
 * The transcript shows one understated line, not a stack of chips, so the
 * wording carries the whole summary. Present participle, lowercase after the
 * first word, no tool names — the owner should not need to know that
 * `desktop_screenshot` exists.
 */
const EXACT: Record<string, string> = {
  workspace_run_python: "Running Python",
  browser_screenshot: "Looking at the page",
  browser_read: "Reading the page",
  memory_save: "Saving a memory",
  ask_user: "Waiting on you",
};

/** Prefix → phrasing, tried in order; first match wins. */
const PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["browser_", "Browsing"],
  ["workspace_", "Working with files"],
  ["schedule_", "Managing routines"],
  ["gmail_", "Working through email"],
  ["googlecalendar_", "Checking your calendar"],
  ["googledrive_", "Looking through your Drive"],
  ["github_", "Checking GitHub"],
  ["notion_", "Checking Notion"],
];

export function activityLabel(toolName: string | null | undefined): string {
  if (!toolName) return "Thinking";

  const exact = EXACT[toolName];
  if (exact) return exact;

  for (const [prefix, label] of PREFIXES) {
    if (toolName.startsWith(prefix)) return label;
  }

  return "Working";
}

export type ChatActivityStatus =
  | "running"
  | "paused_approval"
  | "paused_question"
  | "done"
  | "error"
  | "cancelled";

/**
 * One-line status for a sidebar row. Mirrors Grok Bot's per-chat status line:
 * the owner sees what every chat is doing without opening it.
 */
export function chatStatusLine(run: {
  status: ChatActivityStatus;
  toolName?: string | null;
} | null): string | null {
  if (!run) return null;

  switch (run.status) {
    case "running":
      return activityLabel(run.toolName);
    case "paused_approval":
      return "Needs your approval";
    case "paused_question":
      return "Waiting on your answer";
    case "error":
      return "Stopped with an error";
    case "cancelled":
      return "Cancelled";
    case "done":
      return null;
  }
}
