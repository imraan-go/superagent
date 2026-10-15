import { z } from "zod";
import { json, ownerRoute } from "@/server/lib/route";
import { bridge } from "@/server/manage/bridge";
import { AppError } from "@/server/lib/errors";
import { KEEP_DEFAULT, KEEP_MAX, KEEP_MIN } from "@/lib/manage/snapshot-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.coerce.number().int().min(KEEP_MIN).max(KEEP_MAX);

/** Read-only preview computed by the bridge's collector. A 409 refusal is passed through verbatim. */
export const GET = ownerRoute(async ({ request }) => {
  const raw = new URL(request.url).searchParams.get("keep");
  const parsed = querySchema.safeParse(raw ?? KEEP_DEFAULT);
  if (!parsed.success) throw new AppError("bad_request", `keep must be an integer ${KEEP_MIN}..${KEEP_MAX}.`);
  return json(await bridge.snapshotPlan(parsed.data));
});
