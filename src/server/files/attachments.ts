import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { files } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { isImageMime } from "@/lib/uploads";
import type { MessagePart } from "@/lib/messages";

/**
 * Turns uploaded file ids into message parts (images as `image`, everything
 * else as `file`), preserving the order the owner attached them in. Also binds
 * unattached files to the chat so they show up in its Library.
 */
export async function attachmentParts(ids: string[], chatId: string): Promise<MessagePart[]> {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)];
  const rows = await db.select().from(files).where(inArray(files.id, unique));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const parts: MessagePart[] = [];
  for (const id of unique) {
    const row = byId.get(id);
    if (!row) throw new AppError("bad_request", "An attached file no longer exists.");
    if (!row.chatId) await db.update(files).set({ chatId }).where(eq(files.id, id));
    parts.push(
      isImageMime(row.mime)
        ? { type: "image", fileId: row.id, mime: row.mime, alt: row.name }
        : { type: "file", fileId: row.id, name: row.name, mime: row.mime, bytes: row.bytes },
    );
  }
  return parts;
}
