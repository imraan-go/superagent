import type { AppEnv } from '@superagent/config';
import { usdToNanos } from '@superagent/observability';

/** Installation budget caps from the environment; user settings can only tighten them. */
export function budgetDefaultsFor(env: AppEnv) {
  return {
    perRunNanos: env.MAX_COST_PER_RUN ? usdToNanos(env.MAX_COST_PER_RUN) : null,
    monthlyNanos: env.MONTHLY_COST_LIMIT ? usdToNanos(env.MONTHLY_COST_LIMIT) : null,
  };
}
