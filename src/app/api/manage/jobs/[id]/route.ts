import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";
import { bridge } from "@/server/manage/bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = ownerRoute<Ctx>(async ({ ctx }) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{12}$/.test(id)) throw new AppError("bad_request", "Malformed job id.");
  return json({ job: await bridge.job(id) });
});
