import { z } from "zod";
import { appendMessage, getChat, updateChat } from "@/server/chat/repo";
import { expirePausedRuns, startAgentRun } from "@/server/agent/loop";
import { findModel, resolveDefaultModel } from "@/server/models";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  text: z.string().trim().min(1, "Say something first.").max(32_000),
  model: z.string().trim().min(1).optional(),
});

/**
 * Sends a turn and starts a run.
 *
 * Returns as soon as the run is registered; the transcript arrives over
 * `/api/runs/{id}/events`. The run is detached from this request, so closing
 * the tab does not cancel it.
 */
export const POST = ownerRoute<Ctx>(async ({ request, owner, ctx }) => {
  const { id: chatId } = await ctx.params;
  if (!z.uuid().safeParse(chatId).success) {
    throw new AppError("not_found", "That chat does not exist.");
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    throw new AppError("bad_request", body.error.issues[0]?.message ?? "Invalid body.");
  }

  // Also the ownership check: a chat belonging to anyone else is "not found".
  const chat = await getChat(chatId, owner.userId);

  if (chat.status === "running") {
    throw new AppError("conflict", "This chat already has a run in progress.");
  }

  const requested = body.data.model ?? chat.model ?? undefined;
  const model = (requested ? findModel(requested) : undefined) ?? resolveDefaultModel();

  await expirePausedRuns(chatId, owner.userId);

  const message = await appendMessage(chatId, owner.userId, {
    role: "user",
    content: [{ type: "text", text: body.data.text }],
  });

  // Remember the choice so the next turn in this chat defaults to it.
  if (chat.model !== model.id) {
    await updateChat(chatId, owner.userId, { model: model.id });
  }

  const runId = await startAgentRun({
    chatId,
    userId: owner.userId,
    modelId: model.id,
  });

  return json({ message, runId, model: model.id }, { status: 202 });
});
