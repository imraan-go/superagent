import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Redirect convenience only: pages other than /login need a Better Auth session cookie. The
 * cookie's presence is checked here; the API verifies it on every request (server components ask
 * it via /api/me), and /api/* is excluded because the API enforces auth and Origin checks itself.
 */
const PUBLIC_PATHS = ["/login"];
const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (SESSION_COOKIES.some((c) => request.cookies.has(c))) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except the API, Next's own assets and static files.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
