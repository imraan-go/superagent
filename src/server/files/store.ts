import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { eq, inArray, or } from "drizzle-orm";
import { db } from "@/server/db";
import { files, messages } from "@/server/db/schema";
import { env } from "@/server/env";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import type { FileInfo } from "@/lib/uploads";
import { ALLOWED_EXTENSIONS, validateUpload } from "@/lib/uploads";
import type { MessagePart } from "@/lib/messages";

/**
 * File storage. Bytes live on disk outside the web root, content-addressed by
 * sha256 (`<dir>/<aa>/<sha>`); the `files` row carries name/mime/origin. The
 * unique index on `files.sha256` makes dedupe global: the same bytes uploaded
 * twice return the original row.
 */
export function uploadsDir(): string {
  const configured = env.UPLOAD_DIR?.trim();
  if (configured) return path.resolve(configured);
  return env.NODE_ENV === "production" ? "/var/lib/tj-lhos-panel/uploads" : path.resolve(process.cwd(), "uploads");
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function blobPath(sha: string): string {
  return path.join(uploadsDir(), sha.slice(0, 2), sha);
}

type FileRow = typeof files.$inferSelect;

export function toInfo(row: FileRow): FileInfo {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    bytes: row.bytes,
    origin: row.origin,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Re-encodes raster images (strips EXIF/GPS and any appended payloads, caps
 * the longest edge). `sharp` ships with Next but is not a direct dependency,
 * so a failure to load it degrades to storing the bytes as validated rather
 * than failing the upload. GIFs are kept verbatim (animation).
 */
async function sanitizeImage(bytes: Buffer, ext: string): Promise<Buffer> {
  if (ext === "gif") return bytes;
  try {
    const { default: sharp } = await import("sharp");
    const pipeline = sharp(bytes, { failOn: "error" })
      .rotate()
      .resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true });
    const out =
      ext === "png"
        ? pipeline.png()
        : ext === "webp"
          ? pipeline.webp({ quality: 90 })
          : pipeline.jpeg({ quality: 90 });
    return await out.toBuffer();
  } catch (err) {
    logger.warn("files", { msg: "image re-encode skipped", detail: String(err) });
    return bytes;
  }
}

async function writeBlob(sha: string, bytes: Uint8Array): Promise<string> {
  const target = blobPath(sha);
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, bytes, { mode: 0o600 });
  await rename(tmp, target);
  return target;
}

export interface SaveInput {
  name: string;
  bytes: Buffer;
  origin: "upload" | "tool";
  chatId?: string | null;
  runId?: string | null;
}

export interface SaveResult {
  file: FileInfo;
  deduped: boolean;
}

/** Validates (uploads only), sanitises, dedupes by sha256, stores, inserts. */
export async function saveFile(input: SaveInput): Promise<SaveResult> {
  const validated = validateUpload({
    name: input.name,
    bytes: input.bytes.byteLength,
    head: input.bytes.subarray(0, 16),
  });
  if (!validated.ok) {
    throw new AppError("bad_request", validated.message);
  }

  const stored =
    validated.kind.category === "image"
      ? await sanitizeImage(input.bytes, validated.ext)
      : input.bytes;
  const sha = sha256Hex(stored);

  const [existing] = await db.select().from(files).where(eq(files.sha256, sha)).limit(1);
  if (existing) {
    // Adopt the file into this chat if it was unattached.
    if (!existing.chatId && input.chatId) {
      await db.update(files).set({ chatId: input.chatId }).where(eq(files.id, existing.id));
      existing.chatId = input.chatId;
    }
    return { file: toInfo(existing), deduped: true };
  }

  const target = await writeBlob(sha, stored);
  const [row] = await db
    .insert(files)
    .values({
      sha256: sha,
      name: validated.name,
      mime: validated.kind.mime,
      bytes: stored.byteLength,
      path: target,
      chatId: input.chatId ?? null,
      runId: input.runId ?? null,
      origin: input.origin,
    })
    // A concurrent identical upload loses the race harmlessly.
    .onConflictDoNothing({ target: files.sha256 })
    .returning();

  if (row) return { file: toInfo(row), deduped: false };

  const [raced] = await db.select().from(files).where(eq(files.sha256, sha)).limit(1);
  if (!raced) throw new AppError("internal", "Could not store the file.");
  return { file: toInfo(raced), deduped: true };
}

/** Saves a tool screenshot (image block from an LHOS result). */
export async function saveToolImage(args: {
  mime: string;
  dataB64: string;
  toolName: string;
  chatId: string;
  runId: string;
}): Promise<FileInfo | null> {
  const ext =
    Object.entries(ALLOWED_EXTENSIONS).find(
      ([e, k]) => k.mime === args.mime && e !== "jpeg",
    )?.[0] ?? "png";
  try {
    const { file } = await saveFile({
      name: `${args.toolName}.${ext}`,
      bytes: Buffer.from(args.dataB64, "base64"),
      origin: "tool",
      chatId: args.chatId,
      runId: args.runId,
    });
    return file;
  } catch (err) {
    logger.warn("files", { msg: "tool image not saved", detail: String(err) });
    return null;
  }
}

export async function getFileRow(id: string): Promise<FileRow | null> {
  const [row] = await db.select().from(files).where(eq(files.id, id)).limit(1);
  return row ?? null;
}

export async function getFileInfos(ids: string[]): Promise<FileInfo[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(files).where(inArray(files.id, ids));
  return rows.map(toInfo);
}

export async function readFileBytes(row: Pick<FileRow, "path" | "sha256">): Promise<Buffer> {
  return readFile(row.path.startsWith("/") ? row.path : blobPath(row.sha256));
}

/** File ids referenced by message parts (attachments and tool screenshots). */
export function fileIdsInParts(parts: MessagePart[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (p.type === "image" || p.type === "file") out.push(p.fileId);
    else if (p.type === "tool_result") out.push(...p.images);
  }
  return out;
}

/**
 * This chat's Library: files attached to the chat plus anything its messages
 * reference (a deduped file may belong to an earlier chat).
 */
export async function listChatFiles(chatId: string): Promise<FileInfo[]> {
  const rows = await db
    .select({ content: messages.content })
    .from(messages)
    .where(eq(messages.chatId, chatId));
  const referenced = new Set<string>();
  for (const r of rows) for (const id of fileIdsInParts((r.content ?? []) as MessagePart[])) referenced.add(id);

  const found = await db
    .select()
    .from(files)
    .where(
      referenced.size > 0
        ? or(eq(files.chatId, chatId), inArray(files.id, [...referenced]))
        : eq(files.chatId, chatId),
    );
  return found
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(toInfo);
}
