import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import { NotFoundError } from '../errors';
import { artifacts, chatMessages, chats, questions, tasks, toolCalls } from '../schema';
import { isUuid } from './tasks';

export type ChatRow = typeof chats.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type ChatPart = Record<string, unknown> & { type: string };

export async function createChat(db: DbOrTx, ownerId: string, title?: string) {
  const [row] = await db.insert(chats).values({ ownerId, title: title || 'New chat' }).returning();
  return row!;
}

export async function getChatForOwner(db: DbOrTx, ownerId: string, chatId: string) {
  if (!isUuid(chatId)) throw new NotFoundError('chat');
  const rows = await db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.ownerId, ownerId))).limit(1);
  if (!rows[0]) throw new NotFoundError('chat');
  return rows[0];
}

export async function listChats(db: DbOrTx, ownerId: string, limit = 200) {
  return db.select().from(chats).where(eq(chats.ownerId, ownerId)).orderBy(desc(chats.updatedAt)).limit(limit);
}

export async function updateChat(db: DbOrTx, ownerId: string, chatId: string, patch: Partial<Pick<ChatRow, 'title' | 'pinned' | 'archived' | 'model' | 'prefs'>>) {
  const rows = await db
    .update(chats)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(chats.id, chatId), eq(chats.ownerId, ownerId)))
    .returning();
  if (!rows[0]) throw new NotFoundError('chat');
  return rows[0];
}

export async function touchChat(db: DbOrTx, ownerId: string, chatId: string) {
  await db.update(chats).set({ updatedAt: new Date() }).where(and(eq(chats.id, chatId), eq(chats.ownerId, ownerId)));
}

export async function deleteChat(db: DbOrTx, ownerId: string, chatId: string) {
  await getChatForOwner(db, ownerId, chatId);
  await db.delete(chats).where(and(eq(chats.id, chatId), eq(chats.ownerId, ownerId)));
}

/** Idempotent when `dedupeKey` is set: a retried Activity never posts the same note twice. */
export async function appendChatMessage(
  db: DbOrTx,
  m: { ownerId: string; chatId: string; role: 'user' | 'assistant' | 'system'; content: ChatPart[]; taskId?: string | null; model?: string | null; dedupeKey?: string },
) {
  const rows = await db
    .insert(chatMessages)
    .values({ ownerId: m.ownerId, chatId: m.chatId, role: m.role, content: m.content, taskId: m.taskId ?? null, model: m.model ?? null, dedupeKey: m.dedupeKey ?? null })
    .onConflictDoNothing({ target: chatMessages.dedupeKey })
    .returning();
  await touchChat(db, m.ownerId, m.chatId);
  return rows[0] ?? null;
}

export async function listChatMessages(db: DbOrTx, ownerId: string, chatId: string) {
  return db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.chatId, chatId), eq(chatMessages.ownerId, ownerId)))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
}

/** Latest run per chat, for the sidebar's status dot and status line. */
export async function latestTasksByChat(db: DbOrTx, ownerId: string, chatIds: string[]) {
  if (!chatIds.length) return new Map<string, typeof tasks.$inferSelect>();
  const rows = await db
    .selectDistinctOn([tasks.chatId])
    .from(tasks)
    .where(and(eq(tasks.ownerId, ownerId), inArray(tasks.chatId, chatIds)))
    .orderBy(tasks.chatId, desc(tasks.createdAt));
  return new Map(rows.map((r) => [r.chatId!, r]));
}

export async function listChatTasks(db: DbOrTx, ownerId: string, chatId: string) {
  return db.select().from(tasks).where(and(eq(tasks.ownerId, ownerId), eq(tasks.chatId, chatId))).orderBy(asc(tasks.createdAt));
}

export function partsToText(parts: ChatPart[]): string {
  return parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('\n')
    .trim();
}

/**
 * Earlier turns of a chat as plain model messages, oldest first, for a new run's context.
 * Only user text and the assistant's final answers are carried: tool traffic stays with the run
 * that produced it. Bounded by turns and characters so long chats stay cheap.
 */
export async function chatHistoryForModel(db: DbOrTx, ownerId: string, chatId: string, opts: { maxTurns?: number; maxChars?: number } = {}) {
  const maxTurns = opts.maxTurns ?? 20;
  const maxChars = opts.maxChars ?? 24_000;
  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.chatId, chatId), eq(chatMessages.ownerId, ownerId), inArray(chatMessages.role, ['user', 'assistant'])))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(maxTurns);
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let used = 0;
  for (const r of rows) {
    const parts = r.content as ChatPart[];
    let text = partsToText(parts);
    if (!text) continue;
    // Earlier runs' tool traffic is not replayed, so say what was actually done: without this the
    // model sees only its prose and may later "correct" claims it really did act on.
    if (r.role === 'assistant') {
      const results = new Map(parts.filter((p) => p.type === 'tool_result').map((p) => [String(p.toolUseId), p.ok === true]));
      const used = parts.filter((p) => p.type === 'tool_use').map((p) => `${String(p.name)} (${results.get(String(p.id)) ? 'succeeded' : 'did not succeed'})`);
      if (used.length) text = `${text}\n\n[Tools actually used in this turn: ${[...new Set(used)].join(', ')}]`;
    }
    if (used + text.length > maxChars) break;
    used += text.length;
    out.push({ role: r.role as 'user' | 'assistant', content: text });
  }
  out.reverse();
  // Providers expect alternating turns starting with the user.
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}

/**
 * The display parts for a finished run: one tool_use/tool_result pair per tool call, then the
 * final text. Screenshots and exports are referenced by artifact id (served by /api/uploads/:id).
 */
export async function runParts(db: DbOrTx, ownerId: string, taskId: string, finalText: string): Promise<ChatPart[]> {
  const calls = await db.select().from(toolCalls).where(and(eq(toolCalls.ownerId, ownerId), eq(toolCalls.taskId, taskId))).orderBy(asc(toolCalls.createdAt));
  const arts = await db.select().from(artifacts).where(and(eq(artifacts.ownerId, ownerId), eq(artifacts.taskId, taskId))).orderBy(asc(artifacts.createdAt));
  const asks = await db.select().from(questions).where(and(eq(questions.ownerId, ownerId), eq(questions.taskId, taskId)));
  const askByCall = new Map(asks.map((q) => [q.toolCallId, q]));
  const parts: ChatPart[] = [];
  for (const c of calls) {
    if (c.status === 'invalid') continue;
    const q = askByCall.get(c.id);
    if (q) {
      // The question (and its answer) sits in the trace where it was asked; a confirm gate
      // precedes the call it guarded.
      parts.push(questionPart(q));
      if (c.toolName === 'ask_user') continue;
    }
    const images = arts.filter((a) => a.contentType.startsWith('image/') && (a.source as { toolCallId?: string }).toolCallId === c.id);
    parts.push({ type: 'tool_use', id: c.id, name: c.toolName, args: (c.input as Record<string, unknown>) ?? {} });
    parts.push({ type: 'tool_result', toolUseId: c.id, name: c.toolName, ok: c.status === 'done', text: c.resultSummary ?? c.status, images: images.map((a) => a.id) });
  }
  for (const a of arts) {
    if (a.contentType.startsWith('image/') && (a.source as { kind?: string }).kind === 'browser_screenshot') continue;
    parts.push({ type: 'file', fileId: a.id, name: a.name, mime: a.contentType, bytes: a.sizeBytes });
  }
  if (finalText) parts.push({ type: 'text', text: finalText });
  return parts;
}

export function questionPart(q: typeof questions.$inferSelect): ChatPart {
  return {
    type: 'question',
    questionId: q.id,
    kind: q.kind,
    prompt: q.prompt,
    options: q.options,
    status: q.status,
    answer: q.answer ?? null,
    expiresAt: q.expiresAt.toISOString(),
  };
}

export async function chatFiles(db: DbOrTx, ownerId: string, chatId: string) {
  const taskIds = db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.ownerId, ownerId), eq(tasks.chatId, chatId)));
  return db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.ownerId, ownerId), sql`${artifacts.deletedAt} is null`, sql`(${artifacts.chatId} = ${chatId} or ${artifacts.taskId} in (${taskIds}))`))
    .orderBy(desc(artifacts.createdAt));
}
