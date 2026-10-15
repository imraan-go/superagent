import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { loginAttempts } from "@/server/db/schema";

/**
 * Login limiter: 5 failures per IP per 15 minutes (rule 30-security).
 *
 * Backed by Postgres rather than process memory so the limit survives a panel
 * restart — otherwise `docker restart` would reset an attacker's budget.
 */
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

export interface RateLimitState {
  blocked: boolean;
  failures: number;
  /** Seconds until the window frees up; 0 when not blocked. */
  retryAfterS: number;
}

export async function checkLoginRate(ip: string): Promise<RateLimitState> {
  const since = new Date(Date.now() - WINDOW_MS);

  const rows = await db
    .select({
      failures: sql<number>`count(*)::int`,
      oldest: sql<Date | null>`min(${loginAttempts.ts})`,
    })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.ip, ip),
        eq(loginAttempts.ok, false),
        gte(loginAttempts.ts, since),
      ),
    );

  const row = rows[0];
  const failures = row?.failures ?? 0;
  if (failures < MAX_FAILURES) {
    return { blocked: false, failures, retryAfterS: 0 };
  }

  const oldest = row?.oldest ? new Date(row.oldest).getTime() : Date.now();
  const retryAfterS = Math.max(1, Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000));
  return { blocked: true, failures, retryAfterS };
}

export async function recordLoginAttempt(ip: string, ok: boolean): Promise<void> {
  await db.insert(loginAttempts).values({ ip, ok });

  // A success clears the IP's failure budget immediately.
  if (ok) {
    await db
      .delete(loginAttempts)
      .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.ok, false)));
  }
}

/**
 * Best-effort client IP. Caddy sets X-Forwarded-For; direct dev requests fall
 * back to a constant, which is fine for a single-owner panel.
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
