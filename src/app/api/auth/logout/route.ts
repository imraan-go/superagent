import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST-only: a GET logout would be triggerable by any cross-site image tag. */
export async function POST() {
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ ok: true });
}
