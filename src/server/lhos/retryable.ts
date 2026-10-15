/**
 * Classifies LHOS failures so the UI can distinguish "the computer is waking
 * up" from a genuine error (skill-agent-loop §Gotchas, docs/MCP_REFERENCE.md).
 *
 * The desktop sandbox may be recreating or restoring from a snapshot for
 * 30–60 s. Tool calls during that window fail with liveness errors that are
 * retryable; treating them as fatal would abort runs for no reason.
 *
 * Pure and dependency-free so it can be unit-tested without a server.
 */

export type FailureKind = "waking" | "unavailable" | "fatal";

/**
 * Phrases the agent server emits while the sandbox is not ready. Matched
 * case-insensitively against the error text.
 */
const WAKING_PATTERNS: readonly RegExp[] = [
  /\bdesk\b.*\b(not ready|unavailable|liveness)\b/i,
  /sandbox\s+(is\s+)?(not\s+found|recreating|restoring|starting|resuming)/i,
  /\b(recreating|restoring|resuming)\s+(the\s+)?desktop\b/i,
  /desktop\s+(is\s+)?(not\s+up|waking|unavailable)/i,
  /\bE2B\b.*\b(502|503|unavailable)\b/i,
  /failed to connect to sandbox/i,
];

/** Transport-level problems that are worth one more attempt. */
const TRANSPORT_PATTERNS: readonly RegExp[] = [
  /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE)\b/,
  /\b(socket hang up|network error|fetch failed)\b/i,
  /\bterminated\b/i,
];

export function classifyFailure(input: {
  status?: number | undefined;
  message?: string | undefined;
}): FailureKind {
  const text = input.message ?? "";

  if (WAKING_PATTERNS.some((re) => re.test(text))) return "waking";

  const status = input.status;
  if (status !== undefined) {
    // 5xx and 429 are server-side and transient; 4xx is the caller's fault.
    if (status === 429 || status >= 500) return "unavailable";
    if (status >= 400) return "fatal";
  }

  if (TRANSPORT_PATTERNS.some((re) => re.test(text))) return "unavailable";

  return "fatal";
}

export function isRetryable(kind: FailureKind): boolean {
  return kind !== "fatal";
}

/**
 * Backoff for the agent loop: waking the desktop takes tens of seconds, while
 * a transport blip clears in a second or two (skill-agent-loop: 30 s, max 4).
 */
export function backoffMs(kind: FailureKind, attempt: number): number {
  if (kind === "waking") return 30_000;
  if (kind === "unavailable") return Math.min(8_000, 1_000 * 2 ** attempt);
  return 0;
}

export const MAX_WAKING_RETRIES = 4;
export const MAX_TRANSPORT_RETRIES = 2;
