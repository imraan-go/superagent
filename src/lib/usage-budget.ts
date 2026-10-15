export type BudgetState = "ok" | "warn" | "over";

export interface BudgetStatus {
  dailyBudgetUsd: number;
  warnAtPct: number;
  /** Today's cost as a percentage of the budget (may exceed 100). */
  pct: number;
  state: BudgetState;
}

/** Budget 0 means "no budget" -> null. `over` once the budget is exceeded. */
export function budgetStatus(
  costUsd: number,
  dailyBudgetUsd: number,
  warnAtPct: number,
): BudgetStatus | null {
  if (!(dailyBudgetUsd > 0)) return null;
  const pct = (costUsd / dailyBudgetUsd) * 100;
  const state: BudgetState = costUsd > dailyBudgetUsd ? "over" : pct >= warnAtPct ? "warn" : "ok";
  return { dailyBudgetUsd, warnAtPct, pct, state };
}
