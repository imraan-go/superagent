import "server-only";
import { getIronSession } from "iron-session";
import type { SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { env } from "@/server/env";
import { getSessionEpoch } from "@/server/settings/store";

/**
 * Owner session (rule 30-security): HttpOnly, Secure, SameSite=Lax,
 * 30-day rolling. There is no registration endpoint and no second account.
 *
 * SameSite=Lax rather than Strict is deliberate: the VNC viewer is embedded
 * from a sibling `*.h22t.com` host, and Strict would break returning from the
 * viewer's sign-in popup.
 */
export interface SessionData {
  userId: string;
  email: string;
  /** Unix seconds — used to expire the splash once per session. */
  loggedInAt: number;
}

const THIRTY_DAYS_S = 60 * 60 * 24 * 30;

export const sessionOptions: SessionOptions = {
  password: env.PANEL_SECRET_KEY,
  cookieName: "fd_session",
  ttl: THIRTY_DAYS_S,
  cookieOptions: {
    httpOnly: true,
    // Dev runs on plain http://127.0.0.1; production is always behind Caddy TLS.
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

/** Session if signed in, otherwise null. Does not throw. */
export async function getOwner(): Promise<SessionData | null> {
  const session = await getSession();
  // Fields are optional on a fresh cookie; a present userId means signed in.
  if (!session.userId || !session.email) return null;
  // "Sign out everywhere" (Settings → Danger zone) bumps this epoch; every
  // session minted before it is dead. Cached in-process for 5 s.
  const epoch = await getSessionEpoch().catch(() => 0);
  if ((session.loggedInAt ?? 0) < epoch) return null;
  return {
    userId: session.userId,
    email: session.email,
    loggedInAt: session.loggedInAt ?? 0,
  };
}
