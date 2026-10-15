import { z } from "zod";
import { json, ownerRoute } from "@/server/lib/route";
import { bridge } from "@/server/manage/bridge";
import { parseBody } from "@/server/manage/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ confirm: z.literal("ROTATE", { error: "Type ROTATE to confirm." }) });

/**
 * Starts the rotate-auth bridge job (audited by the bridge client). The new
 * tokens only reach this panel after scripts/sync-env.sh and a panel restart.
 */
export const POST = ownerRoute(async ({ request }) => {
  await parseBody(request, bodySchema);
  return json({ job: await bridge.rotateAuth() });
});
