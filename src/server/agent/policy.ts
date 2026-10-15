/**
 * Which tool calls must stop for the owner's explicit approval.
 *
 * Rule 00-project: irreversible agent actions (post/send/pay/delete) round-trip
 * the approval system, and nothing auto-approves. Settings may make this
 * *stricter* by adding patterns; it can never remove a default
 * (skill-approvals-hitl §Gotchas).
 */
import { isComposioReadAction, parseNamespaced } from "@/server/connectors/naming";


/** Verbs that make a tool call irreversible from the outside world's view. */
const DEFAULT_PATTERNS: readonly RegExp[] = [
  /(^|_)(send|post|publish|submit|reply|comment|dm|tweet)(_|$)/i,
  /(^|_)(pay|purchase|checkout|order|transfer|refund)(_|$)/i,
  /(^|_)(delete|destroy|remove|trash|wipe|drop|purge)(_|$)/i,
  /(^|_)(share|invite|grant|revoke)(_|$)/i,
  /(^|_)(deploy|release|merge|push)(_|$)/i,
];

export interface ApprovalPolicy {
  /** Extra patterns from Settings → Approvals, as source strings. */
  extraPatterns?: readonly string[];
  /** Tools the owner has explicitly cleared. Cannot clear a default pattern. */
  allowlist?: readonly string[];
}

export interface ApprovalDecision {
  required: boolean;
  /** Which rule matched — shown on the approval card so the owner sees why. */
  reason: string | null;
}

/**
 * Checkpoint decision for one tool call.
 *
 * The allowlist is checked *after* the default patterns deliberately: an owner
 * allowlisting `post_tweet` must not silently disable the approval gate on it.
 * Only non-default matches (patterns they added themselves) can be cleared.
 */
export function requiresApproval(
  toolName: string,
  policy: ApprovalPolicy = {},
  args?: Record<string, unknown>,
): ApprovalDecision {
  // Match on a canonical form so `sendEmail`, `gmail.send`, `Send-Message`
  // and `MCP__x__SEND` cannot slip past the `_`-delimited verb patterns.
  const canonical = normalizeToolName(toolName);
  const byArgs = argumentGate(canonical, args);
  if (byArgs) return { required: true, reason: byArgs };

  // Third-party app actions (Composio, directly or through its MCP server) are
  // default-deny: only a recognisable read verb (get/list/fetch/search…) runs
  // unattended. Everything else (create/update/add/move/… as well as the
  // send/post/delete class below) stops for the owner.
  const external = parseNamespaced(toolName);
  const viaComposio = external?.ns === "composio" || (external?.ns === "mcp" && external.group === "composio");
  if (viaComposio && external?.action && !HTTP_TOOL.test(canonical) && !isComposioReadAction(external.action)) {
    return { required: true, reason: `"${external.action.replace(/_/g, " ")}" changes data in a connected app` };
  }

  for (const pattern of DEFAULT_PATTERNS) {
    if (pattern.test(canonical)) {
      return { required: true, reason: describe(pattern, canonical) };
    }
  }

  for (const source of policy.extraPatterns ?? []) {
    const pattern = compilePattern(source);
    // A malformed pattern from Settings must not disable checkpointing.
    if (!pattern) continue;
    if (pattern.test(toolName) || pattern.test(canonical)) {
      if (policy.allowlist?.includes(toolName)) continue;
      return { required: true, reason: `matches your rule /${source}/` };
    }
  }

  return { required: false, reason: null };
}

/**
 * Settings patterns are either a bare verb (`send`, `archive`) — matched as a
 * whole `_`-separated word so `post` does not catch `postgres_query` — or a
 * regular expression source for anything finer.
 */
export function compilePattern(source: string): RegExp | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  if (/^[A-Za-z0-9]+$/.test(trimmed)) return new RegExp(`(^|_)${trimmed}(_|$)`, "i");
  try {
    return new RegExp(trimmed, "i");
  } catch {
    return null;
  }
}

/**
 * Tools whose name is neutral but whose *arguments* make them outbound and
 * irreversible: a raw HTTP request that writes (POST to an API can send, pay or
 * delete as surely as `send_email` can).
 */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Any raw-HTTP style tool, however it is namespaced (`mcp__x__http_request`, `fetch_url`, `curl`). */
const HTTP_TOOL = /(^|_)(http|https|fetch|curl|wget|webhook|api_call|rest_call)(_|$)|http_?request$/;

function argumentGate(canonical: string, args?: Record<string, unknown>): string | null {
  if (!args || !HTTP_TOOL.test(canonical)) return null;
  for (const key of ["method", "http_method", "verb"]) {
    const raw = args[key];
    if (typeof raw !== "string") continue;
    const method = raw.trim().toUpperCase();
    // Anything other than a known-safe read is treated as a write.
    if (!["GET", "HEAD", "OPTIONS", ""].includes(method) || WRITE_METHODS.has(method)) {
      return `an outbound ${method} request is irreversible`;
    }
  }
  return null;
}

/**
 * Canonical tool name for matching: camelCase split, every non-alphanumeric
 * run (`.`, `-`, `/`, `__`, spaces) collapsed to one `_`, lower-cased.
 */
export function normalizeToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function describe(pattern: RegExp, toolName: string): string {
  const verb = pattern.exec(toolName)?.[2]?.toLowerCase() ?? "an irreversible action";
  return `"${verb}" is irreversible`;
}

/** The default list, for the Settings UI to display as non-removable. */
export function defaultApprovalPatterns(): string[] {
  return DEFAULT_PATTERNS.map((p) => p.source);
}
