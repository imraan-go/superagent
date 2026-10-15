import "server-only";
import { NextResponse } from "next/server";
import { getOwner } from "@/server/auth/session";
import type { SessionData } from "@/server/auth/session";
import { AppError, toAppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";

/**
 * Wraps a route handler with the two things every authenticated endpoint
 * needs: an owner-session check and structured error mapping.
 *
 * Middleware only sees whether the cookie exists; this verifies the sealed
 * session, so it is the real authorisation boundary.
 */
export function ownerRoute<Ctx = unknown>(
  handler: (args: { request: Request; owner: SessionData; ctx: Ctx }) => Promise<Response>,
) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    try {
      const owner = await getOwner();
      if (!owner) throw new AppError("unauthorized", "Sign in required.");
      return await handler({ request, owner, ctx });
    } catch (err) {
      return errorResponse(err, new URL(request.url).pathname);
    }
  };
}

export function errorResponse(err: unknown, path?: string): NextResponse {
  const appErr = toAppError(err);

  // 5xx is ours to investigate; 4xx is expected traffic.
  if (appErr.status >= 500) {
    logger.error("route", { path, code: appErr.code, message: appErr.message });
  }

  return NextResponse.json(appErr.toJSON(), {
    status: appErr.status,
    headers: { "cache-control": "no-store" },
  });
}

/** JSON response with caching disabled — the default for every API route here. */
export function json(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: { "cache-control": "no-store", ...init?.headers },
  });
}
