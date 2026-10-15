import { z } from "zod";
import { json, ownerRoute } from "@/server/lib/route";
import { bridge } from "@/server/manage/bridge";
import { parseBody } from "@/server/manage/ops";
import { enforceRateLimit } from "@/server/lib/rate";
import { KEEP_MAX, KEEP_MIN } from "@/lib/manage/snapshot-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ keep: z.number().int().min(KEEP_MIN).max(KEEP_MAX) });

/**
 * Moves the bridge's own plan aside (reversible, frees nothing). The bridge
 * re-plans server-side; the client never supplies build ids.
 */
export const POST = ownerRoute(async ({ request }) => {
  enforceRateLimit("hostAction");
  const { keep } = await parseBody(request, bodySchema);
  return json(await bridge.snapshotQuarantine(keep));
});
