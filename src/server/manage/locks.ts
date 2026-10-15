import "server-only";

/**
 * Snapshot pruning is locked off panel-wide: pruning broke the diff-layer
 * chain (incident 2026-10). Nothing in the panel may enable, run or call it.
 */
export function isLockedSchedule(name: string): boolean {
  return /snapshot[-_ ]?prune/i.test(name);
}

/** Maintenance tasks the panel may run. Everything else (notably snapshot_prune) is refused. */
export const RUNNABLE_MAINTENANCE_TASKS = ["fs_prune"] as const;
