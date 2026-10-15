import { z } from "zod";
import { deleteWebhook, setWebhookEnabled } from "@/server/automation/webhooks";
import { parseBody } from "@/server/lib/body";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function hookId(ctx: Ctx): Promise<string> {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new AppError("not_found", "No such webhook.");
  return id;
}

export const PATCH = ownerRoute<Ctx>(async ({ request, ctx }) => {
  const body = await parseBody(request, z.object({ enabled: z.boolean() }));
  await setWebhookEnabled(await hookId(ctx), body.enabled);
  return json({ ok: true });
});

export const DELETE = ownerRoute<Ctx>(async ({ ctx }) => {
  await deleteWebhook(await hookId(ctx));
  return json({ ok: true });
});
