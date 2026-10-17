export type BudgetState = 'ok' | 'warn' | 'over';

/** The owner's effective monthly limit (installation cap, tightened by their own setting). */
export interface BudgetStatus {
  limitUsd: number;
  period: 'month';
  warnAtPct: number;
  /** This month's cost as a percentage of the limit (may exceed 100). */
  pct: number;
  state: BudgetState;
}
