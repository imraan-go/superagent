import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";
import { bridge } from "@/server/manage/bridge";
import { logQuerySchema, parseUnit } from "@/server/manage/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ unit: string }> };

export const GET = ownerRoute<Ctx>(async ({ request, ctx }) => {
  const unit = parseUnit((await ctx.params).unit);
  const sp = new URL(request.url).searchParams;
  const q = logQuerySchema.safeParse({
    n: sp.get("n") ?? undefined,
    since: sp.get("since") ?? undefined,
  });
  if (!q.success) throw new AppError("bad_request", q.error.issues[0]?.message ?? "Bad query.");
  return json({ unit, lines: await bridge.logs(unit, q.data.n, q.data.since) });
});
