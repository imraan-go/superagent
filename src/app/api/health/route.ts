import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Container healthcheck (docker-compose). Unauthenticated on purpose — it is
 * only bound to loopback and reports no sensitive detail.
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json(
      { ok: true, db: "up" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
