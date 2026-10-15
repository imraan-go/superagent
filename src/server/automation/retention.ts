import "server-only";
import { unlink } from "node:fs/promises";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/server/db";
import { audit, chats, files } from "@/server/db/schema";
import { logger } from "@/server/lib/logger";
import { retentionCutoff } from "@/lib/retention";
import { getSection } from "@/server/settings/store";

/**
 * `data.retentionDays` enforcement (0 = keep forever). Deletes chats whose last
 * activity is older than the cutoff, except pinned ones. messages and runs
 * (and run steps) go with the chat via FK cascade; `usage_events` keep their
 * rows (chat_id -> NULL) so spend history survives. Upload rows belonging to
 * the deleted chats are removed, and their blobs unlinked unless another row
 * (sha256 dedupe) still points at the same path. Logged to `audit`.
 */
const DAY_MS = 86_400_000;
const g = globalThis as unknown as { __fdRetentionAt?: number };

export async function runRetention(now = new Date()): Promise<{ chats: number; files: number } | null> {
  const { retentionDays } = await getSection("data");
  const cutoff = retentionCutoff(retentionDays, now);
  if (!cutoff) return null;

  const old = await db
    .select({ id: chats.id })
    .from(chats)
    .where(and(lt(chats.updatedAt, cutoff), eq(chats.pinned, false)));
  if (old.length === 0) return { chats: 0, files: 0 };
  const ids = old.map((c) => c.id);

  const doomedFiles = await db
    .select({ id: files.id, path: files.path })
    .from(files)
    .where(inArray(files.chatId, ids));
  if (doomedFiles.length > 0) {
    await db.delete(files).where(
      inArray(
        files.id,
        doomedFiles.map((f) => f.id),
      ),
    );
  }
  await db.delete(chats).where(inArray(chats.id, ids));

  // Unlink blobs no surviving row references.
  const paths = [...new Set(doomedFiles.map((f) => f.path))];
  let unlinked = 0;
  if (paths.length > 0) {
    const stillUsed = new Set(
      (await db.select({ path: files.path }).from(files).where(inArray(files.path, paths))).map((r) => r.path),
    );
    for (const p of paths) {
      if (stillUsed.has(p) || !p.startsWith("/")) continue;
      try {
        await unlink(p);
        unlinked++;
      } catch {
        // already gone
      }
    }
  }

  await db.insert(audit).values({
    action: "retention.prune",
    detail: { retentionDays, cutoff: cutoff.toISOString(), chats: ids.length, files: doomedFiles.length, blobs: unlinked },
    ok: true,
  });
  logger.info("retention", { chats: ids.length, files: doomedFiles.length });
  return { chats: ids.length, files: doomedFiles.length };
}

/** Called every scheduler tick; does real work at most once per 24 h. */
export async function maybeRunRetention(now = new Date()): Promise<void> {
  if (g.__fdRetentionAt && now.getTime() - g.__fdRetentionAt < DAY_MS) return;
  g.__fdRetentionAt = now.getTime();
  try {
    await runRetention(now);
  } catch (err) {
    logger.warn("retention", { msg: "failed", detail: String(err) });
    await db
      .insert(audit)
      .values({ action: "retention.prune", detail: {}, ok: false, result: String(err).slice(0, 500) })
      .catch(() => {});
  }
}
