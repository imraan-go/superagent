import type { Capability } from "./capabilities";

/**
 * Auto capability selection for the composer chips. Pure, rules-only (no
 * model call, zero cost): keyword/intent rules map an owner prompt onto the
 * chips, ordered by the LHOS priority ladder (docs/MCP_REFERENCE.md):
 * API/connectors > structured browser > OCR/computer > screenshots.
 *
 * Auto never fails closed: when nothing matches, or the prompt is ambiguous,
 * it returns no chips, which means "the full allowlist". Like manual chips,
 * the result can only narrow the owner's allowlist (narrowByCapabilities).
 */
export interface AutoPick {
  /** Chosen chips in priority order; empty = no narrowing (full set). */
  chosen: Capability[];
  /** Why, one line per match ("matched 'windows' → RDP"). */
  reasons: string[];
}

interface Rule {
  cap: Capability;
  label: string;
  pattern: RegExp;
}

/** Well-known SaaS names → Connectors (also any connected toolkit name). */
const SAAS =
  "gmail|google calendar|calendar|google drive|google docs|google sheets|sheets|notion|linkedin|slack|github|jira|trello|asana|hubspot|salesforce|stripe|shopify|airtable|dropbox|outlook|discord|twitter|x\\.com|facebook|instagram|youtube|zoom|figma|todoist|clickup|monday\\.com|zendesk|intercom|mailchimp";

const RULES: readonly Rule[] = [
  { cap: "connectors", label: "Connectors", pattern: new RegExp(`\\b(${SAAS}|composio|pipedream|api|webhook)\\b`, "i") },
  { cap: "mcp", label: "MCP", pattern: /\b(mcp|mcp server)\b/i },
  {
    cap: "rdp",
    label: "RDP",
    pattern:
      /\b(windows|rdp|remote desktop|my pc|my computer|my laptop|notepad\+\+|notepad|excel|word doc|powershell|explorer|%userprofile%|\\\\tsclient|rdp_\w+)\b|notepad\+\+/i,
  },
  {
    cap: "browser",
    label: "Browser",
    pattern:
      /\b(website|web ?page|web site|url|link|browser|chrome|google it|search the web|search online|look up|lookup|open https?|https?:\/\/\S+|www\.\S+|\w+\.(com|org|net|io|dev|ai)\b|heading|scrape|sign ?in page)\b/i,
  },
  {
    cap: "computer",
    label: "Computer",
    pattern:
      /\b(file|files|folder|directory|~\/\S*|persist|terminal|shell|command|run `|bash|python|script|uname|ls|screen|screenshot|desktop|click|scroll|type|window|workflow|workflows|schedule|schedules|pace|share)\b/i,
  },
  { cap: "memory", label: "Memory", pattern: /\b(remember|forget|memory|memories|what do you know about me)\b/i },
];

/** Priority ladder: earlier wins when ordering the chosen chips. */
const PRIORITY: readonly Capability[] = ["connectors", "mcp", "browser", "rdp", "computer", "memory"];

export function classifyCapabilities(text: string, connectedToolkits: readonly string[] = []): AutoPick {
  const chosen = new Set<Capability>();
  const reasons: string[] = [];
  const lower = text.toLowerCase();

  for (const tk of connectedToolkits) {
    const name = tk.toLowerCase().trim();
    if (name.length >= 3 && new RegExp(`\\b${escape(name)}\\b`, "i").test(lower)) {
      chosen.add("connectors");
      reasons.push(`matched connected toolkit '${name}' → Connectors`);
    }
  }

  // Negated mentions ("do not connect to RDP", "without the browser") are
  // instructions about what NOT to use, so they are blanked before matching.
  const affirmative = stripNegated(text);

  for (const rule of RULES) {
    const m = affirmative.match(rule.pattern);
    if (!m) continue;
    if (!chosen.has(rule.cap)) reasons.push(`matched '${m[0].trim()}' → ${rule.label}`);
    chosen.add(rule.cap);
  }

  // Fallbacks down the ladder, so Auto never strands a task:
  // a connector task may need the browser when the API lacks an action;
  // a web task may need the computer (OCR/screenshots); RDP work is driven
  // through the GUI family and often needs files on the Linux side.
  if (chosen.has("connectors")) chosen.add("browser");
  if (chosen.has("browser")) chosen.add("computer");
  if (chosen.has("rdp")) chosen.add("computer");

  // Only memory matched: that is a narrow intent, not an operator task.
  if (chosen.size === 0) {
    return { chosen: [], reasons: ["no clear match → full tool set"] };
  }
  return { chosen: PRIORITY.filter((c) => chosen.has(c)), reasons };
}

/** Blanks clauses that start with a negation up to the next sentence break. */
export function stripNegated(text: string): string {
  return text.replace(/\b(do not|don't|dont|never|without|no need to|avoid)\b[^.;!?\n]*/gi, " ");
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
