import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { chats, messages, runSteps, runs } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { deriveTitle, partsToText } from "@/lib/messages";
import type { ChatMessage, MessagePart, MessageRole } from "@/lib/messages";
import { chatStatusLine } from "@/lib/activity";
import type { ChatActivityStatus } from "@/lib/activity";

export interface ChatSummary {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  /** Null when nothing is in flight — the row then shows its timestamp instead. */
  status: ChatActivityStatus | null;
  statusLine: string | null;
}

export interface ChatDetail extends ChatSummary {
  messages: ChatMessage[];
}

/**
 * Ownership is enforced in the query itself rather than by a separate read —
 * every lookup is `(id, userId)`, so a wrong owner is indistinguishable from a
 * missing chat and there is no window between checking and acting.
 */
function ownedChat(chatId: string, userId: string) {
  return and(eq(chats.id, chatId), eq(chats.userId, userId));
}

export async function createChat(
  userId: string,
  options?: { title?: string; model?: string },
): Promise<ChatSummary> {
  const [row] = await db
    .insert(chats)
    .values({
      userId,
      ...(options?.title ? { title: options.title } : {}),
      ...(options?.model ? { model: options.model } : {}),
    })
    .returning();

  if (!row) throw new AppError("internal", "Could not create the chat.");
  return toSummary(row, null);
}

/**
 * Sidebar list. Joins each chat's most recent run and that run's most recent
 * tool step so a row can render "Clicking around" without an N+1 of follow-up
 * queries (DESIGN_SYSTEM §Reference reading).
 */
export async function listChats(
  userId: string,
  options?: { includeArchived?: boolean; limit?: number },
): Promise<ChatSummary[]> {
  const latestRun = db
    .select({
      id: runs.id,
      chatId: runs.chatId,
      status: runs.status,
      startedAt: runs.startedAt,
      rank: sql<number>`row_number() over (partition by ${runs.chatId} order by ${runs.startedAt} desc)`.as(
        "rank",
      ),
    })
    .from(runs)
    .as("latest_run");

  const latestStep = db
    .select({
      runId: runSteps.runId,
      toolName: runSteps.toolName,
      rank: sql<number>`row_number() over (partition by ${runSteps.runId} order by ${runSteps.idx} desc)`.as(
        "step_rank",
      ),
    })
    .from(runSteps)
    .where(eq(runSteps.type, "tool"))
    .as("latest_step");

  const rows = await db
    .select({
      chat: chats,
      status: latestRun.status,
      toolName: latestStep.toolName,
    })
    .from(chats)
    .leftJoin(latestRun, and(eq(latestRun.chatId, chats.id), eq(latestRun.rank, 1)))
    .leftJoin(
      latestStep,
      and(eq(latestStep.runId, latestRun.id), eq(latestStep.rank, 1)),
    )
    .where(
      options?.includeArchived
        ? eq(chats.userId, userId)
        : and(eq(chats.userId, userId), eq(chats.archived, false)),
    )
    // Pinned first, then most recently touched (chats_user_updated_idx).
    .orderBy(desc(chats.pinned), desc(chats.updatedAt))
    .limit(options?.limit ?? 200);

  return rows.map((r) =>
    toSummary(r.chat, r.status ? { status: r.status, toolName: r.toolName } : null),
  );
}

export async function getChat(chatId: string, userId: string): Promise<ChatDetail> {
  const [row] = await db.select().from(chats).where(ownedChat(chatId, userId)).limit(1);
  if (!row) throw new AppError("not_found", "That chat does not exist.");

  const turns = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(messages.createdAt));

  const [latest] = await db
    .select({ status: runs.status })
    .from(runs)
    .where(eq(runs.chatId, chatId))
    .orderBy(desc(runs.startedAt))
    .limit(1);

  return {
    ...toSummary(row, latest ? { status: latest.status, toolName: null } : null),
    messages: turns.map((m) => ({
      id: m.id,
      role: m.role as MessageRole,
      content: (m.content ?? []) as MessagePart[],
      model: m.model,
      runId: m.runId,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function updateChat(
  chatId: string,
  userId: string,
  patch: { title?: string; pinned?: boolean; archived?: boolean; model?: string },
): Promise<ChatSummary> {
  const [row] = await db
    .update(chats)
    .set({ ...patch, updatedAt: new Date() })
    .where(ownedChat(chatId, userId))
    .returning();

  if (!row) throw new AppError("not_found", "That chat does not exist.");
  return toSummary(row, null);
}

export async function deleteChat(chatId: string, userId: string): Promise<void> {
  const deleted = await db.delete(chats).where(ownedChat(chatId, userId)).returning({
    id: chats.id,
  });
  if (deleted.length === 0) throw new AppError("not_found", "That chat does not exist.");
}

/**
 * Appends a turn and touches the chat.
 *
 * A chat still named "New chat" is titled from the first user turn in the same
 * transaction, so the sidebar never shows a placeholder once a message exists.
 * A model-written title may replace it later (purpose `title-gen`).
 */
export async function appendMessage(
  chatId: string,
  userId: string,
  turn: { role: MessageRole; content: MessagePart[]; model?: string; runId?: string },
): Promise<ChatMessage> {
  return db.transaction(async (tx) => {
    const [chat] = await tx
      .select({ id: chats.id, title: chats.title })
      .from(chats)
      .where(ownedChat(chatId, userId))
      .limit(1);

    if (!chat) throw new AppError("not_found", "That chat does not exist.");

    const [row] = await tx
      .insert(messages)
      .values({
        chatId,
        role: turn.role,
        content: turn.content,
        ...(turn.model ? { model: turn.model } : {}),
        ...(turn.runId ? { runId: turn.runId } : {}),
      })
      .returning();

    if (!row) throw new AppError("internal", "Could not save the message.");

    const shouldTitle = turn.role === "user" && chat.title === "New chat";
    await tx
      .update(chats)
      .set({
        updatedAt: new Date(),
        ...(shouldTitle ? { title: deriveTitle(partsToText(turn.content)) } : {}),
      })
      .where(eq(chats.id, chatId));

    return {
      id: row.id,
      role: row.role as MessageRole,
      content: (row.content ?? []) as MessagePart[],
      model: row.model,
      runId: row.runId,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

type ChatRow = typeof chats.$inferSelect;

function toSummary(
  row: ChatRow,
  run: { status: ChatActivityStatus; toolName?: string | null } | null,
): ChatSummary {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    archived: row.archived,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    status: run?.status ?? null,
    statusLine: chatStatusLine(run),
  };
}
