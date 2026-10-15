import { z } from "zod";

/**
 * Snapshot cleanup: bridge response shapes and the pure UI logic (badges,
 * button-enable state machine, desktop-verify evaluation). No server imports,
 * so the client components and the bridge client share one source of truth.
 *
 * Safety model: deletion is only ever proposed by the bridge's own plan
 * (`/snapshots/plan`); nothing here computes or accepts a list of ids.
 */

export const KEEP_MIN = 2;
export const KEEP_MAX = 20;
export const KEEP_DEFAULT = 3;
/** A build younger than this is never planned for deletion (mirrors snapshot_gc.py). */
export const RECENT_MINUTES = 360;

export const clampKeep = (n: number): number =>
  Number.isFinite(n) ? Math.min(KEEP_MAX, Math.max(KEEP_MIN, Math.trunc(n))) : KEEP_DEFAULT;

export const planSchema = z.looseObject({
  roots: z.array(z.string()),
  keepDesktop: z.number().optional(),
  keepCount: z.number(),
  keepBytes: z.number(),
  delete: z.array(z.object({ id: z.string(), bytes: z.number(), status: z.string() })),
  deleteBytes: z.number(),
  missingRoots: z.array(z.string()).default([]),
});
export type CleanupPlan = z.infer<typeof planSchema>;

export const quarantineResultSchema = z.object({
  quarantine: z.string().nullable(),
  moved: z.number(),
  bytes: z.number(),
});
export type QuarantineResult = z.infer<typeof quarantineResultSchema>;

export const quarantineSchema = z.object({
  name: z.string(),
  builds: z.number(),
  bytes: z.number(),
  created: z.number(),
});
export type Quarantine = z.infer<typeof quarantineSchema>;
export const quarantinesSchema = z.object({ quarantines: z.array(quarantineSchema) });

export const restoreResultSchema = z.object({ restored: z.number() });
export const purgeResultSchema = z.object({ purged: z.string(), freedBytes: z.number() });

export const QUARANTINE_NAME_RE = /^snapshot-quarantine-[0-9-]+$/;

/* ------------------------------------------------------------- badges -- */

export type BuildBadge = "kept-root" | "kept-ancestor" | "deletable" | "in-flight";

export function badgeFor(
  build: string,
  ageMin: number,
  plan: Pick<CleanupPlan, "roots" | "delete"> | undefined,
): BuildBadge | null {
  if (!plan) return null;
  if (plan.roots.includes(build)) return "kept-root";
  if (plan.delete.some((d) => d.id === build)) return "deletable";
  // Kept but neither a root nor planned: a young/in-flight build or an ancestor layer.
  return ageMin < RECENT_MINUTES ? "in-flight" : "kept-ancestor";
}

export const BADGE_LABEL: Record<BuildBadge, string> = {
  "kept-root": "kept: root",
  "kept-ancestor": "kept: ancestor",
  deletable: "deletable",
  "in-flight": "in-flight / recent",
};

/* ------------------------------------------------- button state machine -- */

export interface CleanupState {
  keep: number;
  /** The keep value the currently shown plan was computed for. */
  planKeep: number | null;
  plan: CleanupPlan | undefined;
  busy: boolean;
}

export const canPreview = (s: Pick<CleanupState, "busy" | "keep">): boolean =>
  !s.busy && s.keep >= KEEP_MIN && s.keep <= KEEP_MAX;

/** Quarantine needs a fresh (same keep) plan that actually has something to remove. */
export const canQuarantine = (s: CleanupState): boolean =>
  !s.busy && !!s.plan && s.planKeep === s.keep && s.plan.delete.length > 0;

export interface PurgeState {
  verified: boolean;
  override: boolean;
  typed: string;
  busy: boolean;
}

export const canPurge = (s: PurgeState): boolean =>
  !s.busy && (s.verified || s.override) && s.typed === "DELETE";

export const canRestore = (s: { busy: boolean }): boolean => !s.busy;

/* ---------------------------------------------------------- verification -- */

export const VERIFY_TIMEOUT_MS = 120_000;

export interface VerifySample {
  /** `since` of e2b-desktop-vnc before the restart was issued. */
  sinceBefore: string | null;
  since: string | null;
  active: string | null;
  desktopService: string | null;
  elapsedMs: number;
}

export type VerifyOutcome = { state: "pending" } | { state: "ok" } | { state: "failed"; reason: string };

/**
 * The restart is `--no-block`, so the first polls can still see the old
 * process: only an `active` unit with a new start time (or a grace period)
 * counts, and the desktop endpoint must agree.
 */
export function evaluateVerify(s: VerifySample): VerifyOutcome {
  const restarted = s.since !== s.sinceBefore || s.elapsedMs > 15_000;
  const up = s.active === "active" && s.desktopService === "active";
  if (restarted && up) return { state: "ok" };
  if (s.elapsedMs > VERIFY_TIMEOUT_MS) {
    return {
      state: "failed",
      reason: `e2b-desktop-vnc is "${s.active ?? "unknown"}" (desktop reports "${s.desktopService ?? "unknown"}") after ${Math.round(
        VERIFY_TIMEOUT_MS / 1000,
      )} s. Restore the quarantine.`,
    };
  }
  return { state: "pending" };
}

export const formatGb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
