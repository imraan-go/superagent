import { z } from "zod";
import { getChat } from "@/server/chat/repo";
import { listChatFiles } from "@/server/files/store";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** The Library tab: this chat's uploads and tool screenshots, newest first. */
export const GET = ownerRoute<Ctx>(async ({ owner, ctx }) => {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new AppError("not_found", "That chat does not exist.");
  await getChat(id, owner.userId);
  return json({ files: await listChatFiles(id) });
});
