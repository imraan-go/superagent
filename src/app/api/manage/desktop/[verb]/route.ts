import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";
import { bridge } from "@/server/manage/bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ verb: string }> };

const verbSchema = z.enum(["sleep", "wake", "new"]);
const bodySchema = z.object({ confirm: z.string().optional() });

/**
 * Starts a desktop bridge job and returns it; the UI polls /api/manage/jobs/[id].
 * `new` destroys the current desktop, so it additionally needs the typed phrase.
 */
export const POST = ownerRoute<Ctx>(async ({ request, ctx }) => {
  const verb = verbSchema.safeParse((await ctx.params).verb);
  if (!verb.success) throw new AppError("bad_request", "Unknown desktop action.");

  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) throw new AppError("bad_request", "Invalid body.");
  if (verb.data === "new" && body.data.confirm !== "NEW DESKTOP") {
    throw new AppError("bad_request", "Type NEW DESKTOP to confirm.");
  }

  return json({ job: await bridge.desktopAction(verb.data) });
});
