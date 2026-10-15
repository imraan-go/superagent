import { bridge } from "@/server/manage/bridge";
import { assertBridgeAnswerable, markDecided } from "@/server/hitl/pending";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { json, ownerRoute } from "@/server/lib/route";
import { hitlIdSchema } from "../id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Marks a `takeover` request finished ("I'm done, hand it back to the agent")
 * through the host bridge. Owner session only; audited by the bridge client.
 */
export const POST = ownerRoute<{ params: Promise<{ id: string }> }>(async ({ owner, ctx }) => {
  const id = hitlIdSchema.safeParse((await ctx.params).id);
  if (!id.success) throw new AppError("bad_request", "Malformed request id.");

  await assertBridgeAnswerable(id.data, "takeover");
  const result = await bridge.doneHitl(id.data);
  await markDecided(id.data, "answered", "done");
  logger.info("hitl.done", { id: id.data, by: owner.email });

  return json({ ok: result.ok });
});
