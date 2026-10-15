import { z } from "zod";
import { bridge } from "@/server/manage/bridge";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Polling target for the Wake button. Read-only. */
export const GET = ownerRoute<Ctx>(async ({ ctx }) => {
  const { id } = await ctx.params;
  if (!z.string().regex(/^[\w-]{1,64}$/).safeParse(id).success) {
    throw new AppError("not_found", "Unknown job.");
  }
  const job = await bridge.job(id);
  return json({ job });
});
