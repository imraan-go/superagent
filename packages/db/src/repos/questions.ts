import { and, eq } from 'drizzle-orm';
import type { Db, DbOrTx } from '../client';
import { ConflictError, NotFoundError } from '../errors';
import { questions, workflowOutbox } from '../schema';
import { isUuid } from './tasks';

export type QuestionRow = typeof questions.$inferSelect;

export const CONFIRM_OPTIONS = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
];

export async function createQuestion(
  db: DbOrTx,
  q: {
    ownerId: string;
    taskId: string;
    chatId: string | null;
    toolCallId: string;
    kind: string;
    prompt: string;
    options: Array<{ id: string; label: string }>;
    gate: boolean;
    expiresAt: Date;
  },
) {
  // Idempotent per tool call: a retried Activity returns the question it already created.
  await db.insert(questions).values(q).onConflictDoNothing({ target: questions.toolCallId });
  const rows = await db
    .select()
    .from(questions)
    .where(and(eq(questions.toolCallId, q.toolCallId), eq(questions.ownerId, q.ownerId)))
    .limit(1);
  return rows[0]!;
}

export async function getQuestionForOwner(db: DbOrTx, ownerId: string, id: string) {
  if (!isUuid(id)) throw new NotFoundError('question');
  const rows = await db
    .select()
    .from(questions)
    .where(and(eq(questions.id, id), eq(questions.ownerId, ownerId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('question');
  return rows[0];
}

export async function pendingQuestionForChat(db: DbOrTx, ownerId: string, chatId: string) {
  const rows = await db
    .select()
    .from(questions)
    .where(and(eq(questions.ownerId, ownerId), eq(questions.chatId, chatId), eq(questions.status, 'pending')))
    .limit(5);
  return rows.find((q) => q.expiresAt.getTime() > Date.now()) ?? null;
}

export async function listPendingQuestions(db: DbOrTx, ownerId: string) {
  const rows = await db
    .select()
    .from(questions)
    .where(and(eq(questions.ownerId, ownerId), eq(questions.status, 'pending')));
  return rows.filter((q) => q.expiresAt.getTime() > Date.now());
}

/**
 * Records the owner's answer and queues the signal that wakes the run, in one transaction. The
 * signal carries only the question id: the workflow re-reads this row, so a forged signal cannot
 * answer anything. Choices must be the question's own option ids.
 */
export async function answerQuestion(db: Db, ownerId: string, id: string, a: { choices: string[]; text?: string }) {
  return db.transaction(async (tx) => {
    if (!isUuid(id)) throw new NotFoundError('question');
    const rows = await tx
      .select()
      .from(questions)
      .where(and(eq(questions.id, id), eq(questions.ownerId, ownerId)))
      .for('update');
    const q = rows[0];
    if (!q) throw new NotFoundError('question');
    if (q.status !== 'pending') throw new ConflictError(`question is already ${q.status}`);
    if (q.expiresAt.getTime() <= Date.now()) {
      await tx.update(questions).set({ status: 'expired' }).where(eq(questions.id, id));
      throw new ConflictError('question has expired');
    }
    const valid = new Set(q.options.map((o) => o.id));
    const choices = [...new Set(a.choices)].filter((c) => valid.has(c));
    if (a.choices.length && choices.length !== new Set(a.choices).size)
      throw new ConflictError('answer contains an unknown option');
    if ((q.kind === 'single' || q.kind === 'confirm') && choices.length > 1) throw new ConflictError('pick one option');
    if (q.kind === 'confirm' && !choices.length) {
      // A typed reply to a Yes/No question is read as "no" unless it clearly says yes.
      choices.push(/^\s*(y|yes|yep|sure|ok|okay|confirm|go ahead|do it)\b/i.test(a.text ?? '') ? 'yes' : 'no');
    }
    const answer = { choices, ...(a.text ? { text: a.text } : {}) };
    await tx.update(questions).set({ status: 'answered', answer, answeredAt: new Date() }).where(eq(questions.id, id));
    await tx
      .insert(workflowOutbox)
      .values({ ownerId, kind: 'signal_question', refId: id, payload: { taskId: q.taskId, questionId: id } })
      .onConflictDoNothing({ target: [workflowOutbox.kind, workflowOutbox.refId] });
    return { ...q, status: 'answered' as const, answer };
  });
}

export async function setQuestionStatus(db: DbOrTx, ownerId: string, id: string, status: 'expired' | 'cancelled') {
  await db
    .update(questions)
    .set({ status })
    .where(and(eq(questions.id, id), eq(questions.ownerId, ownerId), eq(questions.status, 'pending')));
}

/** Plain-language rendering of an answer, as the tool result the model reads. */
export function describeAnswer(q: QuestionRow): string {
  const a = q.answer;
  if (!a) return '';
  const labels = a.choices.map((c) => q.options.find((o) => o.id === c)?.label ?? c);
  const parts: string[] = [];
  if (labels.length) parts.push(`Selected: ${labels.join(', ')}`);
  if (a.text) parts.push(`Typed reply: ${a.text}`);
  return parts.join('\n');
}
