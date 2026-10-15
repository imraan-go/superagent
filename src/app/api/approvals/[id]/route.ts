import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/db/schema";
import { lhos } from "@/server/lhos/client";
import { decideCheckpoint } from "@/server/agent/loop";
import { approvalSource } from "@/server/agent/checkpoint";
import { markDecided } from "@/server/hitl/pending";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only approve/reject for `confirm` items — both panel policy
 * checkpoints (uuid id → the paused run resumes) and LHOS workflow
 * checkpoints (8-hex id → proxied with APPROVE_TOKEN).
 *
 * Security invariants (rule 30-security, skill-approvals-hitl):
 *  - Reachable only behind the owner's authenticated session. `ownerRoute`
 *    enforces this; middleware additionally requires a same-site Origin.
 *  - `APPROVE_TOKEN` is read inside the LHOS client and never leaves the
 *    server, never appears in a response, and is never put in a model prompt.
 *  - The agent loop must never call this route or `decideCheckpoint`. It
 *    decides nothing on its own behalf — that is the point of the approval
 *    system. The agent computer has no session cookie, so even an
 *    `http_request` aimed here is rejected as unauthorised.
 */
const bodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

export const POST = ownerRoute<{ params: Promise<{ id: string }> }>(
  async ({ request, owner, ctx }) => {
    const { id } = await ctx.params;
    const source = approvalSource(id);
    if (!source) throw new AppError("bad_request", "Malformed approval id.");

    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      throw new AppError("bad_request", "decision must be 'approve' or 'reject'.");
    }
    const decision = body.data.decision;

    if (source === "panel") {
      const resumed = await decideCheckpoint({ approvalId: id, decision, userId: owner.userId });
      await db.insert(audit).values({
        action: `approval.${decision}`,
        detail: { approvalId: id, source, runId: resumed.runId },
        ok: true,
        result: "run resumed",
      });
      logger.info("approval.decided", { approvalId: id, source, decision, by: owner.email });
      return json({ ok: true, decision, ...resumed });
    }

    const result = await lhos.decideApproval(id, decision);
    const status = decision === "approve" ? "approved" : "rejected";
    await markDecided(id, status, result.answer ?? status);
    await db.insert(audit).values({
      action: `approval.${decision}`,
      detail: { approvalId: id, source },
      ok: result.ok,
      result: result.answer ?? status,
    });
    logger.info("approval.decided", { approvalId: id, source, decision, by: owner.email });

    return json({ ok: true, decision, answer: result.answer });
  },
);
