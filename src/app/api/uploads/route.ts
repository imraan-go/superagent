import { z } from "zod";
import { getChat } from "@/server/chat/repo";
import { saveFile } from "@/server/files/store";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Multipart upload from the prompt bar (`file`, optional `chatId`). The
 * server is the real gate: extension allowlist + magic bytes + size, images
 * re-encoded, sha256 dedupe — all in `saveFile`.
 */
export const POST = ownerRoute(async ({ request, owner }) => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  // Multipart overhead is small; anything far past the cap is refused unread.
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    throw new AppError("bad_request", `Files are limited to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
  }

  const form = await request.formData().catch(() => null);
  if (!form) throw new AppError("bad_request", "Expected a multipart form upload.");
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("bad_request", "No file in the upload.");

  const rawChatId = form.get("chatId");
  let chatId: string | null = null;
  if (typeof rawChatId === "string" && rawChatId) {
    if (!z.uuid().safeParse(rawChatId).success) throw new AppError("bad_request", "Malformed chat id.");
    await getChat(rawChatId, owner.userId); // 404 when not the owner's chat
    chatId = rawChatId;
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await saveFile({ name: file.name, bytes, origin: "upload", chatId });
  return json(result, { status: result.deduped ? 200 : 201 });
});
