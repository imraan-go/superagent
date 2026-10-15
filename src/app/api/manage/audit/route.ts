import { desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limitSchema = z.coerce.number().int().min(1).max(200).default(50);

/** Newest-first audit trail of every Manage mutation. */
export const GET = ownerRoute(async ({ request }) => {
  const limit = limitSchema.safeParse(new URL(request.url).searchParams.get("limit") ?? undefined);
  if (!limit.success) throw new AppError("bad_request", "limit must be 1-200.");
  const rows = await db.select().from(audit).orderBy(desc(audit.ts)).limit(limit.data);
  return json({ entries: rows });
});
