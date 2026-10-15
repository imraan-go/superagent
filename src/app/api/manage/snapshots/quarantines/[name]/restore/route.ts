import { json, ownerRoute } from "@/server/lib/route";
import { bridge } from "@/server/manage/bridge";
import { parseQuarantineName } from "@/server/manage/ops";
import { enforceRateLimit } from "@/server/lib/rate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

export const POST = ownerRoute<Ctx>(async ({ ctx }) => {
  enforceRateLimit("hostAction");
  const name = parseQuarantineName((await ctx.params).name);
  return json(await bridge.snapshotRestore(name));
});
