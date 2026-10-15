import { z } from "zod";
import { appendMessage, getChat, updateChat } from "@/server/chat/repo";
import { expirePausedRuns, startAgentRun } from "@/server/agent/loop";
import { findModel, resolveDefaultModelFromSettings } from "@/server/models";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";
import { attachmentParts } from "@/server/files/attachments";
import { MAX_ATTACHMENTS } from "@/lib/uploads";
import { enforceRateLimit } from "@/server/lib/rate";
import { chatModeSchema } from "@/lib/chat-mode";
import { getChatPrefs, updateChatPrefs } from "@/server/chat/mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    text: z.string().trim().max(32_000).default(""),
    model: z.string().trim().min(1).optional(),
    /** Ids from POST /api/uploads; become image/file parts on the turn. */
    fileIds: z.array(z.uuid()).max(MAX_ATTACHMENTS).optional(),
    /** Composer chips — can only narrow the tool allowlist (src/lib/capabilities.ts). */
    capabilities: z.array(z.string().max(32)).max(12).optional(),
    /** Conversation mode for this turn; persisted on the chat when it changes. */
    mode: chatModeSchema.optional(),
    /**
     * true = the server picks capabilities from the text (Auto chip); false =
     * use `capabilities` as the owner's manual narrowing. Absent = the chat's
     * stored preference.
     */
    capabilitiesAuto: z.boolean().optional(),
  })
  .refine((b) => b.text.length > 0 || (b.fileIds?.length ?? 0) > 0, {
    message: "Say something first.",
    path: ["text"],
  });

/**
 * Sends a turn and starts a run.
 *
 * Returns as soon as the run is registered; the transcript arrives over
 * `/api/runs/{id}/events`. The run is detached from this request, so closing
 * the tab does not cancel it.
 */
export const POST = ownerRoute<Ctx>(async ({ request, owner, ctx }) => {
  enforceRateLimit("run");
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
  const model =
    (requested ? findModel(requested) : undefined) ?? (await resolveDefaultModelFromSettings());

  const attachments = await attachmentParts(body.data.fileIds ?? [], chatId);

  await expirePausedRuns(chatId, owner.userId);

  const message = await appendMessage(chatId, owner.userId, {
    role: "user",
    content: [
      ...attachments,
      ...(body.data.text ? [{ type: "text" as const, text: body.data.text }] : []),
    ],
  });

  // Remember the choice so the next turn in this chat defaults to it.
  if (chat.model !== model.id) {
    await updateChat(chatId, owner.userId, { model: model.id });
  }

  const stored = await getChatPrefs(chatId);
  const mode = body.data.mode ?? stored.mode;
  const capsAuto = body.data.capabilitiesAuto ?? (body.data.capabilities ? false : stored.capsAuto);
  const caps = capsAuto ? [] : (body.data.capabilities ?? stored.caps);
  if (mode !== stored.mode || capsAuto !== stored.capsAuto || caps.join() !== stored.caps.join()) {
    await updateChatPrefs(chatId, { mode, capsAuto, caps });
  }

  const runId = await startAgentRun({
    mode,
    chatId,
    userId: owner.userId,
    modelId: model.id,
    capabilities: caps,
    capabilitiesAuto: capsAuto,
    autoText: body.data.text,
  });

  return json({ message, runId, model: model.id, mode }, { status: 202 });
});
