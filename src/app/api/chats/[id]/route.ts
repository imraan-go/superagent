import { z } from "zod";
import { deleteChat, getChat, updateChat } from "@/server/chat/repo";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";
import { deleteChatPrefs, getChatPrefs, updateChatPrefs } from "@/server/chat/mode";
import { chatModeSchema } from "@/lib/chat-mode";

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

export const GET = ownerRoute<Ctx>(async ({ owner, ctx }) => {
  const id = await chatId(ctx);
  const chat = await getChat(id, owner.userId);
  return json({ chat: { ...chat, prefs: await getChatPrefs(id) } });
});

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    model: z.string().trim().min(1).max(120).optional(),
    /** Conversation mode; stored per chat (src/server/chat/mode.ts). */
    mode: chatModeSchema.optional(),
    /** Auto capability chips vs a manual selection; stored with the mode. */
    capsAuto: z.boolean().optional(),
    caps: z.array(z.string().max(32)).max(12).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const PATCH = ownerRoute<Ctx>(async ({ request, owner, ctx }) => {
  const id = await chatId(ctx);
  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    throw new AppError("bad_request", body.error.issues[0]?.message ?? "Invalid body.");
  }

  const { mode, capsAuto, caps, ...patch } = body.data;
  if (mode !== undefined || capsAuto !== undefined || caps !== undefined) {
    await getChat(id, owner.userId); // ownership check
    const prefs = await updateChatPrefs(id, {
      ...(mode !== undefined ? { mode } : {}),
      ...(capsAuto !== undefined ? { capsAuto } : {}),
      ...(caps !== undefined ? { caps } : {}),
    });
    if (Object.keys(patch).length === 0) {
      return json({ chat: { ...(await getChat(id, owner.userId)), prefs } });
    }
  }
  return json({ chat: await updateChat(id, owner.userId, patch) });
});

/** Cascades to messages, runs, steps and events via the schema's FK rules. */
export const DELETE = ownerRoute<Ctx>(async ({ owner, ctx }) => {
  const id = await chatId(ctx);
  await deleteChat(id, owner.userId);
  await deleteChatPrefs(id);
  return json({ ok: true });
});
