import type { TokenUsage } from "./types";

/**
 * Cost maths (skill-token-metering). Pure and vendor-free so it can be unit
 * tested and reused by the Settings usage table.
 *
 * `config/models.json` quotes USD per million tokens. Costs are stored in
 * `numeric(12,6)`, so everything is rounded to 6 decimals — at Opus input rates
 * that is still sub-cent precision, and it keeps the stored value exact.
 */
export interface ModelPrice {
  in: number;
  out: number;
  cachedIn?: number;
}

const PER = 1_000_000;
export const COST_DECIMALS = 6;

export function roundCost(usd: number): number {
  return Math.round(usd * 10 ** COST_DECIMALS) / 10 ** COST_DECIMALS;
}

/**
 * Cached reads are billed at `cachedIn` instead of `in`, so they are subtracted
 * from the uncached input count. Vendors report `cached` as a subset of `in`;
 * double-charging it is the classic metering bug.
 */
export function costUsd(usage: TokenUsage, price: ModelPrice): number {
  const cachedRate = price.cachedIn ?? price.in;
  const uncachedIn = Math.max(0, usage.in - usage.cached);

  const total =
    (uncachedIn * price.in) / PER +
    (usage.cached * cachedRate) / PER +
    (usage.out * price.out) / PER;

  return roundCost(total);
}

/** DB-ready string for a `numeric(12,6)` column. */
export function costToNumeric(usd: number): string {
  return roundCost(usd).toFixed(COST_DECIMALS);
}

/**
 * Pre-final estimate for the live ticker. Streaming vendors only report usage
 * at stream end, so the UI shows this flagged with `~` and replaces it with the
 * exact figure when the `usage` event lands.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { in: a.in + b.in, out: a.out + b.out, cached: a.cached + b.cached };
}

export const ZERO_USAGE: TokenUsage = { in: 0, out: 0, cached: 0 };

// Display formatting is shared with the browser; see src/lib/format.ts.
export { formatCost, formatTokens } from "@/lib/format";
