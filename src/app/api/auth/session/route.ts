import { NextResponse } from "next/server";
import { getOwner } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who am I. Returns `{ owner: null }` rather than 401 so the client can poll. */
export async function GET() {
  const owner = await getOwner();
  return NextResponse.json(
    { owner: owner ? { email: owner.email, loggedInAt: owner.loggedInAt } : null },
    { headers: { "cache-control": "no-store" } },
  );
}
