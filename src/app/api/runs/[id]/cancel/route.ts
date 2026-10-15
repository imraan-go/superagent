import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { chats, runs } from "@/server/db/schema";
import { cancelRun } from "@/server/agent/registry";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Stops a run. Aborting the controller cancels the model stream and any
 * in-flight LHOS call at once, because both share the run's signal.
 */
export const POST = ownerRoute<Ctx>(async ({ owner, ctx }) => {
  const { id: runId } = await ctx.params;
  if (!z.uuid().safeParse(runId).success) {
    throw new AppError("not_found", "That run does not exist.");
  }

  const [run] = await db
    .select({ status: runs.status, userId: chats.userId })
    .from(runs)
    .innerJoin(chats, eq(chats.id, runs.chatId))
    .where(eq(runs.id, runId))
    .limit(1);

  if (!run || run.userId !== owner.userId) {
    throw new AppError("not_found", "That run does not exist.");
  }

  const cancelled = cancelRun(runId);

  // Already finished, or lost to a restart: settle the row so the UI is not
  // left showing a run that nothing is driving.
  if (!cancelled && run.status === "running") {
    await db
      .update(runs)
      .set({ status: "cancelled", endedAt: new Date() })
      .where(eq(runs.id, runId));
  }

  return json({ ok: true, cancelled });
});
