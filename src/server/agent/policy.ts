/**
 * Which tool calls must stop for the owner's explicit approval.
 *
 * Rule 00-project: irreversible agent actions (post/send/pay/delete) round-trip
 * the approval system, and nothing auto-approves. Settings may make this
 * *stricter* by adding patterns; it can never remove a default
 * (skill-approvals-hitl §Gotchas).
 */

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
): ApprovalDecision {
  for (const pattern of DEFAULT_PATTERNS) {
    if (pattern.test(toolName)) {
      return { required: true, reason: describe(pattern, toolName) };
    }
  }

  for (const source of policy.extraPatterns ?? []) {
    const pattern = compilePattern(source);
    // A malformed pattern from Settings must not disable checkpointing.
    if (!pattern) continue;
    if (pattern.test(toolName)) {
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

function describe(pattern: RegExp, toolName: string): string {
  const verb = pattern.exec(toolName)?.[2]?.toLowerCase() ?? "an irreversible action";
  return `"${verb}" is irreversible`;
}

/** The default list, for the Settings UI to display as non-removable. */
export function defaultApprovalPatterns(): string[] {
  return DEFAULT_PATTERNS.map((p) => p.source);
}
