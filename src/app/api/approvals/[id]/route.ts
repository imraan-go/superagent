import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { approvals } from "@/server/db/schema";
import { lhos } from "@/server/lhos/client";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only approve/reject proxy for `confirm` checkpoints.
 *
 * Security invariants (rule 30-security, skill-approvals-hitl):
 *  - Reachable only behind the owner's authenticated session. `ownerRoute`
 *    enforces this; middleware additionally requires a same-site Origin.
 *  - `APPROVE_TOKEN` is read inside the LHOS client and never leaves the
 *    server, never appears in a response, and is never put in a model prompt.
 *  - The agent loop must never call this route. It decides nothing on its own
 *    behalf — that is the entire point of the approval system.
 */
const bodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

const idSchema = z.string().regex(/^[0-9a-f]{8}$/, "Malformed approval id.");

export const POST = ownerRoute<{ params: Promise<{ id: string }> }>(
  async ({ request, owner, ctx }) => {
    const { id: rawId } = await ctx.params;

    const id = idSchema.safeParse(rawId);
    if (!id.success) throw new AppError("bad_request", "Malformed approval id.");

    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      throw new AppError("bad_request", "decision must be 'approve' or 'reject'.");
    }

    const result = await lhos.decideApproval(id.data, body.data.decision);

    // Audit trail: who decided, how, and when.
    logger.info("approval.decided", {
      approvalId: id.data,
      decision: body.data.decision,
      by: owner.email,
    });

    const status = body.data.decision === "approve" ? "approved" : "rejected";
    await db
      .update(approvals)
      .set({
        status,
        answer: result.answer ?? status,
        decidedAt: new Date(),
        decidedVia: "panel",
      })
      .where(eq(approvals.lhosApprovalId, id.data));

    return json({ ok: true, decision: body.data.decision, answer: result.answer });
  },
);
