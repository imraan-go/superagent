import { z } from "zod";
import { createChat, listChats } from "@/server/chat/repo";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sidebar list: pinned first, then most recently touched, with status lines. */
export const GET = ownerRoute(async ({ request, owner }) => {
  const params = new URL(request.url).searchParams;
  const chats = await listChats(owner.userId, {
    includeArchived: params.get("archived") === "1",
  });
  return json({ chats });
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(120).optional(),
});

export const POST = ownerRoute(async ({ request, owner }) => {
  const body = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    throw new AppError("bad_request", body.error.issues[0]?.message ?? "Invalid body.");
  }

  const chat = await createChat(owner.userId, body.data);
  return json({ chat }, { status: 201 });
});
