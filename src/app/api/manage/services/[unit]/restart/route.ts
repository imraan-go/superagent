import { json, ownerRoute } from "@/server/lib/route";
import { bridge } from "@/server/manage/bridge";
import { parseUnit } from "@/server/manage/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ unit: string }> };

/** Restart (caddy: validated reload) one allowlisted unit. Audited by the bridge client. */
export const POST = ownerRoute<Ctx>(async ({ ctx }) => {
  const unit = parseUnit((await ctx.params).unit);
  const result = await bridge.restartService(unit);
  return json({ ok: result.ok, unit, action: result.action });
});
