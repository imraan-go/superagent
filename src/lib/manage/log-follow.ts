/**
 * Log follow-mode helpers. The bridge's `since` filter is second-resolution
 * and inclusive, so each poll can re-return lines already sent; these helpers
 * work out which lines are genuinely new.
 */

/** Leading `journalctl -o short-iso` stamp: `2026-10-15T11:52:01+0000 host unit[1]: msg`. */
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/;

export function lineSecond(line: string): string | null {
  const m = STAMP.exec(line);
  return m ? `${m[1]} ${m[2]}` : null;
}

/** Latest second present in a batch (these stamps sort lexicographically). */
export function latestSecond(lines: readonly string[]): string | null {
  let best: string | null = null;
  for (const l of lines) {
    const s = lineSecond(l);
    if (s && (best === null || s > best)) best = s;
  }
  return best;
}

export interface FollowState {
  /** Pass as the bridge `since` parameter (`YYYY-MM-DD HH:MM:SS`). */
  since: string | null;
  /** Lines already delivered within the `since` second, for de-duplication. */
  boundary: string[];
}

export const INITIAL_FOLLOW: FollowState = { since: null, boundary: [] };

/**
 * Given the previous state and a freshly polled batch, returns the lines not
 * yet delivered plus the state for the next poll. Lines within the boundary
 * second are matched as a multiset, so two genuinely identical lines still
 * both show.
 */
export function advanceFollow(
  state: FollowState,
  fetched: readonly string[],
): { fresh: string[]; next: FollowState } {
  const remaining = new Map<string, number>();
  for (const l of state.boundary) remaining.set(l, (remaining.get(l) ?? 0) + 1);

  const fresh: string[] = [];
  for (const line of fetched) {
    const left = remaining.get(line) ?? 0;
    if (left > 0) {
      remaining.set(line, left - 1);
    } else {
      fresh.push(line);
    }
  }

  const latest = latestSecond(fetched);
  if (latest === null || (state.since !== null && latest < state.since)) {
    return { fresh, next: state };
  }
  if (latest === state.since) {
    return {
      fresh,
      next: {
        since: latest,
        boundary: [...state.boundary, ...fresh.filter((l) => lineSecond(l) === latest)],
      },
    };
  }
  return {
    fresh,
    next: { since: latest, boundary: fetched.filter((l) => lineSecond(l) === latest) },
  };
}

export function grepLines(lines: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...lines];
  return lines.filter((l) => l.toLowerCase().includes(q));
}

export const MAX_LOG_LINES = 2000;
