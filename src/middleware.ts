import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Coarse gate: anything that is not the login page or an auth/health endpoint
 * requires a session cookie. Middleware only checks for the cookie's
 * *presence* — it runs on the edge-style runtime where `iron-session` cannot
 * decrypt — so every route handler and server component still verifies the
 * session properly via `getOwner()`. This is a redirect convenience, not the
 * security boundary.
 *
 * CSRF: mutating API requests must be same-origin (rule 30-security). Webhook
 * and trigger routes are exempt because they authenticate with their own
 * signed tokens.
 */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health"];
const CSRF_EXEMPT_PREFIXES = ["/api/webhooks/", "/api/triggers/"];
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (MUTATING.has(request.method) && !isCsrfExempt(pathname) && !isSameSite(request)) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "Cross-origin request rejected." } },
      { status: 403 },
    );
  }

  if (isPublic(pathname)) return NextResponse.next();

  const hasSession = request.cookies.has("fd_session");
  if (hasSession) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in required." } },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

/**
 * A same-origin browser fetch always sends `Origin`; a cross-site form post
 * sends a different one. Missing `Origin` (curl, server-to-server) is allowed —
 * it carries no ambient cookie.
 *
 * Compared by **host**, not full origin: `nextUrl.origin` is normalised by Next
 * and the scheme differs behind Caddy, which terminates TLS and forwards plain
 * HTTP. Host is the value that actually identifies the site.
 */
function isSameSite(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const expected =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";

  try {
    return new URL(origin).host === expected;
  } catch {
    return false;
  }
}

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isCsrfExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p));
}

export const config = {
  // Everything except Next's own assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
