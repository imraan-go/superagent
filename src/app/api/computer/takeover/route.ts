import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  phase: z.enum(["start", "end"]),
  /** Seconds in control; only meaningful on `end`. */
  seconds: z.number().int().nonnegative().max(86_400).optional(),
  runId: z.uuid().optional(),
});

/**
 * Records the owner taking and releasing manual control of the desktop, so the
 * audit trail shows who was driving when (skill-vnc-embed step 3).
 */
export const POST = ownerRoute(async ({ request }) => {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) throw new AppError("bad_request", "Invalid takeover event.");
  await db.insert(audit).values({
    action: `computer.takeover.${body.data.phase}`,
    detail: { seconds: body.data.seconds ?? null, runId: body.data.runId ?? null },
    ok: true,
  });
  return json({ ok: true });
});
