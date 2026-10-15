import { z } from "zod";
import { lhos } from "@/server/lhos/client";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

/** Per-tool-call activity feed — Manage mode's activity list and analytics. */
export const GET = ownerRoute(async ({ request }) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    date: url.searchParams.get("date") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    throw new AppError("bad_request", parsed.error.issues[0]?.message ?? "Bad query.");
  }

  const events = await lhos.getEvents(parsed.data);
  return json({ count: events.length, events });
});
