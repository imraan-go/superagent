import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";
import { isLockedSchedule } from "@/server/manage/locks";
import { auditedTool, parseBody, toolText } from "@/server/manage/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

const nameSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
const bodySchema = z.object({ action: z.enum(["enable", "disable", "run"]) });

export const POST = ownerRoute<Ctx>(async ({ request, ctx }) => {
  const name = nameSchema.safeParse((await ctx.params).name);
  if (!name.success) throw new AppError("bad_request", "Invalid schedule name.");
  const { action } = await parseBody(request, bodySchema);

  if (isLockedSchedule(name.data)) {
    throw new AppError("conflict", "snapshot-prune is locked off (diff-layer chain incident, 2026-10).");
  }

  const text = await auditedTool(`schedule.${action}`, { name: name.data }, () =>
    action === "run"
      ? toolText("schedule_run_now", { name: name.data })
      : toolText("schedule_enable", { name: name.data, on: action === "enable" }),
  );
  return json({ ok: true, output: text.slice(0, 1000) });
});
