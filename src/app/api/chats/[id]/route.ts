import { z } from "zod";
import { deleteChat, getChat, updateChat } from "@/server/chat/repo";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function chatId(ctx: Ctx): Promise<string> {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    throw new AppError("not_found", "That chat does not exist.");
  }
  return id;
}

export const GET = ownerRoute<Ctx>(async ({ owner, ctx }) =>
  json({ chat: await getChat(await chatId(ctx), owner.userId) }),
);

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    model: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const PATCH = ownerRoute<Ctx>(async ({ request, owner, ctx }) => {
  const id = await chatId(ctx);
  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    throw new AppError("bad_request", body.error.issues[0]?.message ?? "Invalid body.");
  }

  return json({ chat: await updateChat(id, owner.userId, body.data) });
});

/** Cascades to messages, runs, steps and events via the schema's FK rules. */
export const DELETE = ownerRoute<Ctx>(async ({ owner, ctx }) => {
  await deleteChat(await chatId(ctx), owner.userId);
  return json({ ok: true });
});
