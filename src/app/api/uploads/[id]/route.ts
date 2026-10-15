import { z } from "zod";
import { getFileRow, readFileBytes } from "@/server/files/store";
import { AppError } from "@/server/lib/errors";
import { ownerRoute } from "@/server/lib/route";
import { servingHeaders } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Serves a stored file to the owner only, with `servingHeaders` (nosniff, CSP). */
export const GET = ownerRoute<Ctx>(async ({ ctx }) => {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new AppError("not_found", "That file does not exist.");
  const row = await getFileRow(id);
  if (!row) throw new AppError("not_found", "That file does not exist.");

  let bytes: Buffer;
  try {
    bytes = await readFileBytes(row);
  } catch {
    throw new AppError("not_found", "That file is no longer stored.");
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: servingHeaders({ mime: row.mime, name: row.name, bytes: bytes.byteLength }),
  });
});
