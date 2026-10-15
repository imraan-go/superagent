import { lockedToolReason } from "./guard";

/** Hard cap so a runaway file can never blow up every request. */
export const GUIDE_MAX_CHARS = 16_000;

export const GUIDE_HEADER = `## Operating guide (LHOS)
The know-how below comes from LHOS's own operator guide. Where it conflicts with
the rules above (approvals, untrusted data, owner-only tools), the rules above
win. Only call tools you were actually offered; tools named here that are not
in your tool list are unavailable this run. Saving workflows, schedules,
connectors and vault keys is owner-only in this panel: if one is missing, ask
the owner to add it in Settings instead of trying to create it.`;

/**
 * Pure trimming for the operator guide:
 * - drops any line that names a tool the panel locks for the agent (vault,
 *   trigger links, schedule/workflow creation): those flows are owner-only
 *   here, and mentioning them invites calls the guard refuses;
 * - drops the guide's own identity line (the panel prompt sets identity);
 * - collapses blank runs and caps the length.
 */
export function trimGuide(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const kept = lines.filter((line, i) => {
    if (i === 0 && /^You are /.test(line)) return false;
    const names = line.match(/`([a-z][a-z0-9_]+)(?:\([^`]*\))?`/g) ?? [];
    return !names.some((n) => {
      const name = n.replace(/`|\(.*$/g, "");
      // `approval_id` / `awaiting_approval` are fields, not tools.
      return !name.includes("approval") && lockedToolReason(name) !== null;
    });
  });
  let text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return "";
  if (text.length > GUIDE_MAX_CHARS) text = `${text.slice(0, GUIDE_MAX_CHARS)}\n…[guide trimmed]`;
  return `${GUIDE_HEADER}\n\n${text}`;
}
