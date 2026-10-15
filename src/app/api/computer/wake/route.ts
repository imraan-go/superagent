import { bridge } from "@/server/manage/bridge";
import { json, ownerRoute } from "@/server/lib/route";
import { enforceRateLimit } from "@/server/lib/rate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wakes the agent computer through the host bridge. Returns the bridge job;
 * the client polls `/api/computer/jobs/{id}` until it ends. Audited by the
 * bridge client like every other mutation.
 */
export const POST = ownerRoute(async () => {
  enforceRateLimit("hostAction");
  const job = await bridge.desktopAction("wake");
  return json({ job }, { status: 202 });
});
