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
  desktop_screenshot: "Looking at the screen",
  screen_text: "Reading the screen",
  desktop_click: "Clicking around",
  desktop_double_click: "Clicking around",
  desktop_right_click: "Opening a menu",
  desktop_type: "Typing",
  desktop_key: "Pressing keys",
  desktop_scroll: "Scrolling",
  desktop_move_mouse: "Moving the mouse",
  desktop_drag: "Dragging",
  desktop_wait: "Waiting",
  set_pace: "Adjusting its pace",
  hitl_check: "Waiting on you",
  ask_user: "Waiting on you",
  request_takeover: "Asking you to take over",
};

/** Prefix → phrasing, tried in order; first match wins. */
const PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["browser_", "Browsing"],
  ["desktop_", "Working on the desktop"],
  ["file_", "Working with files"],
  ["fs_", "Working with files"],
  ["rdp_", "Working on the Windows machine"],
  ["skill_", "Running a skill"],
  ["schedule_", "Managing schedules"],
  ["api_", "Calling an API"],
  ["mail_", "Working through email"],
  ["search", "Searching"],
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
