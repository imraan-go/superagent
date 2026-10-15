import { describe, expect, it } from "vitest";
import {
  ZERO_USAGE,
  addUsage,
  costToNumeric,
  costUsd,
  estimateTokens,
  formatCost,
  roundCost,
} from "@/server/models/pricing";

/** Claude Sonnet 5.5 rates from config/models.json, in USD per million. */
const SONNET = { in: 3, out: 15, cachedIn: 0.3 };

describe("costUsd", () => {
  it("prices a plain completion", () => {
    // 10k in @ $3/M = $0.03 · 2k out @ $15/M = $0.03
    expect(costUsd({ in: 10_000, out: 2_000, cached: 0 }, SONNET)).toBe(0.06);
  });

  it("bills cached reads at the cached rate and never twice", () => {
    // Vendors report `cached` as a subset of `in`: 10k in of which 8k cached.
    // 2k @ $3/M = $0.006 · 8k @ $0.30/M = $0.0024 · 1k out @ $15/M = $0.015
    const cost = costUsd({ in: 10_000, out: 1_000, cached: 8_000 }, SONNET);
    expect(cost).toBeCloseTo(0.0234, 6);

    // Must be cheaper than the same traffic with no cache hit.
    const uncached = costUsd({ in: 10_000, out: 1_000, cached: 0 }, SONNET);
    expect(cost).toBeLessThan(uncached);
  });

  it("falls back to the input rate when a model has no cached price", () => {
    const noCache = { in: 10, out: 30 };
    expect(costUsd({ in: 1_000, out: 0, cached: 1_000 }, noCache)).toBe(
      costUsd({ in: 1_000, out: 0, cached: 0 }, noCache),
    );
  });

  it("never goes negative when cached exceeds the reported input", () => {
    expect(costUsd({ in: 100, out: 0, cached: 500 }, SONNET)).toBeGreaterThanOrEqual(0);
  });

  it("is free for a zero-price model, so the mock never bills", () => {
    expect(costUsd({ in: 50_000, out: 9_000, cached: 0 }, { in: 0, out: 0 })).toBe(0);
  });

  it("rounds to the 6 decimals the numeric column stores", () => {
    const cost = costUsd({ in: 1, out: 1, cached: 0 }, SONNET);
    expect(costToNumeric(cost)).toMatch(/^\d+\.\d{6}$/);
    expect(Number(costToNumeric(cost))).toBe(cost);
  });
});

describe("roundCost", () => {
  it("keeps sub-cent precision instead of truncating to zero", () => {
    expect(roundCost(0.0000004)).toBe(0);
    expect(roundCost(0.0000006)).toBe(0.000001);
    expect(roundCost(0.123456789)).toBe(0.123457);
  });
});

describe("addUsage", () => {
  it("accumulates across the steps of one run", () => {
    const total = [
      { in: 100, out: 20, cached: 0 },
      { in: 300, out: 50, cached: 80 },
    ].reduce(addUsage, ZERO_USAGE);
    expect(total).toEqual({ in: 400, out: 70, cached: 80 });
  });
});

describe("estimateTokens", () => {
  it("approximates four characters per token and never returns a fraction", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("formatCost", () => {
  it("shows enough precision to be meaningful at every magnitude", () => {
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.0042)).toBe("$0.0042");
    expect(formatCost(0.42)).toBe("$0.420");
    expect(formatCost(4.2)).toBe("$4.20");
  });
});
