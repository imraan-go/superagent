import { z } from "zod";
import { json, ownerRoute } from "@/server/lib/route";
import { bridge } from "@/server/manage/bridge";
import { parseBody, parseQuarantineName } from "@/server/manage/ops";
import { enforceRateLimit } from "@/server/lib/rate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

const bodySchema = z.object({ confirm: z.literal("DELETE", { error: "Type DELETE to confirm." }) });

/** Permanent. Only ever addresses an existing quarantine directory, never a live build. */
export const POST = ownerRoute<Ctx>(async ({ request, ctx }) => {
  enforceRateLimit("hostAction");
  const name = parseQuarantineName((await ctx.params).name);
  await parseBody(request, bodySchema);
  return json(await bridge.snapshotPurge(name));
});
