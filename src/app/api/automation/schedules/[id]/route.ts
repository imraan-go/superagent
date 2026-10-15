import { z } from "zod";
import { deleteSchedule, runScheduleNow, setScheduleEnabled } from "@/server/automation/schedules";
import { parseBody } from "@/server/lib/body";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = ownerRoute<Ctx>(async ({ request, ctx }) => {
  const { id } = await ctx.params;
  const body = await parseBody(request, z.object({ enabled: z.boolean() }));
  await setScheduleEnabled(id, body.enabled);
  return json({ ok: true });
});

export const DELETE = ownerRoute<Ctx>(async ({ ctx }) => {
  const { id } = await ctx.params;
  await deleteSchedule(id);
  return json({ ok: true });
});

/** Run now. */
export const POST = ownerRoute<Ctx>(async ({ ctx }) => {
  const { id } = await ctx.params;
  return json({ ok: true, ...(await runScheduleNow(id)) }, { status: 202 });
});
