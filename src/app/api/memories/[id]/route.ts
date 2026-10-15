import { z } from "zod";
import { deleteMemory, updateMemory } from "@/server/memory";
import { parseBody } from "@/server/lib/body";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function memId(ctx: Ctx): Promise<string> {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new AppError("not_found", "No such memory.");
  return id;
}

export const PATCH = ownerRoute<Ctx>(async ({ request, ctx }) => {
  const body = await parseBody(
    request,
    z.object({
      text: z.string().trim().min(3).max(1000).optional(),
      kind: z.enum(["fact", "preference", "project"]).optional(),
    }),
  );
  if (!(await updateMemory(await memId(ctx), body))) throw new AppError("not_found", "No such memory.");
  return json({ ok: true });
});

export const DELETE = ownerRoute<Ctx>(async ({ ctx }) => {
  if (!(await deleteMemory(await memId(ctx)))) throw new AppError("not_found", "No such memory.");
  return json({ ok: true });
});
