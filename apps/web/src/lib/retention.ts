const DAY_MS = 86_400_000;

/** Cutoff date for `data.retentionDays`; null when 0 (keep forever). */
export function retentionCutoff(retentionDays: number, now = new Date()): Date | null {
  if (!(retentionDays > 0)) return null;
  return new Date(now.getTime() - retentionDays * DAY_MS);
}
