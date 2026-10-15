import { z } from "zod";
import { bridge } from "@/server/manage/bridge";
import { assertBridgeAnswerable, markDecided } from "@/server/hitl/pending";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { json, ownerRoute } from "@/server/lib/route";
import { hitlIdSchema } from "../id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Answers an `ask` request through the host bridge (ADR-02) — the LHOS
 * approvals route rejects anything that is not a `confirm`. Owner session
 * only, same-origin (middleware); the bridge call is audited.
 */
const bodySchema = z.object({
  text: z.string().trim().min(1, "Type an answer first.").max(4_000),
});

export const POST = ownerRoute<{ params: Promise<{ id: string }> }>(
  async ({ request, owner, ctx }) => {
    const id = hitlIdSchema.safeParse((await ctx.params).id);
    if (!id.success) throw new AppError("bad_request", "Malformed request id.");

    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      throw new AppError("bad_request", body.error.issues[0]?.message ?? "Invalid body.");
    }

    await assertBridgeAnswerable(id.data, "ask");
    const result = await bridge.answerHitl(id.data, body.data.text);
    await markDecided(id.data, "answered", body.data.text);
    logger.info("hitl.answered", { id: id.data, by: owner.email });

    return json({ ok: result.ok });
  },
);
