import { WindowLimiter } from "@/server/automation/webhook-signature";
import { AppError } from "@/server/lib/errors";

/**
 * Process-local window limits for owner routes that cost money, CPU or host
 * actions (ADR-04: single instance, so in-memory is sufficient). These bound a
 * stolen session or a runaway client; the session gate handles anonymous
 * traffic.
 */
export const LIMITS = {
  /** Starting an agent run spends model tokens. */
  run: { max: 20, windowMs: 60_000 },
  /** Vendor key tests call a paid API. */
  keyTest: { max: 10, windowMs: 60_000 },
  /** Host actions: restarts, maintenance, wake, auth rotation. */
  hostAction: { max: 6, windowMs: 60_000 },
  /** Connecting / disconnecting third-party apps and creating MCP servers or triggers. */
  connect: { max: 12, windowMs: 60_000 },
  /** Agent-initiated Composio tool executions (each can hit a third-party API). */
  composioExecute: { max: 60, windowMs: 60_000 },
  /** Full-database / usage exports. */
  export: { max: 6, windowMs: 60_000 },
} as const;

export type LimitName = keyof typeof LIMITS;

const g = globalThis as unknown as { __fdRateLimiters?: Map<LimitName, WindowLimiter> };
const limiters = (g.__fdRateLimiters ??= new Map<LimitName, WindowLimiter>());

/** Throws `rate_limited` (429) when `name` is exhausted for `key`. */
export function enforceRateLimit(name: LimitName, key = "owner"): void {
  let limiter = limiters.get(name);
  if (!limiter) {
    limiter = new WindowLimiter(LIMITS[name].max, LIMITS[name].windowMs);
    limiters.set(name, limiter);
  }
  if (!limiter.allow(key)) {
    throw new AppError("rate_limited", "Too many requests. Wait a minute and try again.");
  }
}
