import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { taskWorkflowId, type TaskEventType, type TaskStatus } from '@superagent/contracts';
import { redact } from '@superagent/observability';
import type { DbOrTx, Db } from '../client';
import { NotFoundError } from '../errors';
import { taskEvents, taskMessages, tasks, toolCalls, workflowOutbox } from '../schema';

export interface CreateTaskInput {
  ownerId: string;
  prompt: string;
  title?: string;
  allowedDomains: string[];
  idempotencyKey?: string;
  origin?: 'user' | 'schedule';
  scheduleId?: string;
  readOnly?: boolean;
  timezone?: string;
  retentionDays: number;
}

/**
 * Creates the task row, its first user message, a queued event and a `start_task` outbox row in
 * one transaction. Temporal is started afterwards (and retried by the reconciler), so a crash
 * between DB commit and Temporal start never loses the task, and a duplicate HTTP retry with the
 * same idempotency key returns the existing task instead of creating another.
 */
export async function createTaskWithOutbox(db: Db, input: CreateTaskInput): Promise<{ task: typeof tasks.$inferSelect; created: boolean }> {
  const idem = input.idempotencyKey ?? randomUUID();
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(tasks).where(and(eq(tasks.ownerId, input.ownerId), eq(tasks.idempotencyKey, idem))).limit(1);
    if (existing[0]) return { task: existing[0], created: false };
    const id = randomUUID();
    const [task] = await tx
      .insert(tasks)
      .values({
        id,
        ownerId: input.ownerId,
        title: input.title || input.prompt.slice(0, 80),
        prompt: input.prompt,
        allowedDomains: input.allowedDomains,
        idempotencyKey: idem,
        origin: input.origin ?? 'user',
        scheduleId: input.scheduleId,
        readOnly: input.readOnly ?? false,
        timezone: input.timezone ?? null,
        workflowId: taskWorkflowId(id),
        expiresAt: new Date(Date.now() + input.retentionDays * 86_400_000),
      })
      .onConflictDoNothing({ target: [tasks.ownerId, tasks.idempotencyKey] })
      .returning();
    if (!task) {
      const again = await tx.select().from(tasks).where(and(eq(tasks.ownerId, input.ownerId), eq(tasks.idempotencyKey, idem))).limit(1);
      return { task: again[0]!, created: false };
    }
    await tx.insert(taskMessages).values({ taskId: id, ownerId: input.ownerId, step: 0, kind: 'user', dedupeKey: 'user:0', content: { role: 'user', content: input.prompt } });
    await tx.insert(taskEvents).values({ taskId: id, ownerId: input.ownerId, type: 'task.queued', dedupeKey: 'task.queued', data: { origin: input.origin ?? 'user' } });
    if (input.origin !== 'schedule') {
      await tx.insert(workflowOutbox).values({ ownerId: input.ownerId, kind: 'start_task', refId: id, payload: { taskId: id } });
    }
    return { task, created: true };
  });
}

export async function getTaskForOwner(db: DbOrTx, ownerId: string, taskId: string) {
  if (!isUuid(taskId)) throw new NotFoundError('task');
  const rows = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId))).limit(1);
  if (!rows[0]) throw new NotFoundError('task');
  return rows[0];
}

export async function listTasksForOwner(db: DbOrTx, ownerId: string, limit = 50) {
  return db.select().from(tasks).where(eq(tasks.ownerId, ownerId)).orderBy(desc(tasks.createdAt)).limit(limit);
}

const TERMINAL: TaskStatus[] = ['completed', 'failed', 'cancelled'];

/** Projection update. Terminal states are sticky so a late/duplicate Activity cannot revive a task. */
export async function setTaskStatus(db: DbOrTx, ownerId: string, taskId: string, status: TaskStatus, extra: { resultSummary?: string; error?: string } = {}) {
  const terminal = TERMINAL.includes(status);
  const rows = await db
    .update(tasks)
    .set({ status, updatedAt: new Date(), ...(terminal ? { completedAt: new Date() } : {}), ...extra })
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId), sql`${tasks.status} not in ('completed','failed','cancelled')`))
    .returning({ id: tasks.id });
  return rows.length > 0;
}

export async function appendEvent(db: DbOrTx, e: { ownerId: string; taskId: string; type: TaskEventType; dedupeKey: string; data?: Record<string, unknown> }) {
  await db
    .insert(taskEvents)
    .values({ ownerId: e.ownerId, taskId: e.taskId, type: e.type, dedupeKey: e.dedupeKey, data: redact(e.data ?? {}) as Record<string, unknown> })
    .onConflictDoNothing({ target: [taskEvents.taskId, taskEvents.dedupeKey] });
}

export async function listEvents(db: DbOrTx, ownerId: string, taskId: string, afterId = 0, limit = 200) {
  await getTaskForOwner(db, ownerId, taskId);
  return db
    .select()
    .from(taskEvents)
    .where(and(eq(taskEvents.taskId, taskId), eq(taskEvents.ownerId, ownerId), gt(taskEvents.id, afterId)))
    .orderBy(asc(taskEvents.id))
    .limit(limit);
}

export async function appendMessage(db: DbOrTx, m: { ownerId: string; taskId: string; step: number; kind: 'user' | 'assistant' | 'tool_result'; dedupeKey: string; content: unknown }) {
  const rows = await db
    .insert(taskMessages)
    .values({ ownerId: m.ownerId, taskId: m.taskId, step: m.step, kind: m.kind, dedupeKey: m.dedupeKey, content: m.content as object })
    .onConflictDoNothing({ target: [taskMessages.taskId, taskMessages.dedupeKey] })
    .returning({ id: taskMessages.id });
  return rows.length > 0;
}

export async function getMessageByDedupe(db: DbOrTx, ownerId: string, taskId: string, dedupeKey: string) {
  const rows = await db
    .select()
    .from(taskMessages)
    .where(and(eq(taskMessages.taskId, taskId), eq(taskMessages.ownerId, ownerId), eq(taskMessages.dedupeKey, dedupeKey)))
    .limit(1);
  return rows[0];
}

export async function listMessages(db: DbOrTx, ownerId: string, taskId: string) {
  return db.select().from(taskMessages).where(and(eq(taskMessages.taskId, taskId), eq(taskMessages.ownerId, ownerId))).orderBy(asc(taskMessages.id));
}

export async function upsertToolCalls(db: DbOrTx, rows: Array<typeof toolCalls.$inferInsert>) {
  if (!rows.length) return;
  await db.insert(toolCalls).values(rows).onConflictDoNothing({ target: toolCalls.id });
}

export async function getToolCall(db: DbOrTx, ownerId: string, id: string) {
  const rows = await db.select().from(toolCalls).where(and(eq(toolCalls.id, id), eq(toolCalls.ownerId, ownerId))).limit(1);
  if (!rows[0]) throw new NotFoundError('tool call');
  return rows[0];
}

export async function setToolCallStatus(db: DbOrTx, ownerId: string, id: string, status: string, resultSummary?: string) {
  await db
    .update(toolCalls)
    .set({ status, updatedAt: new Date(), ...(resultSummary !== undefined ? { resultSummary } : {}) })
    .where(and(eq(toolCalls.id, id), eq(toolCalls.ownerId, ownerId)));
}

/* ---------- outbox ---------- */

export async function enqueueOutbox(db: DbOrTx, row: { ownerId: string; kind: string; refId: string; payload?: Record<string, unknown> }) {
  await db
    .insert(workflowOutbox)
    .values({ ownerId: row.ownerId, kind: row.kind, refId: row.refId, payload: row.payload ?? {} })
    .onConflictDoUpdate({
      target: [workflowOutbox.kind, workflowOutbox.refId],
      set: { status: 'pending', availableAt: new Date(), payload: row.payload ?? {}, lastError: null },
    });
}

/** Claims due outbox rows. FOR UPDATE SKIP LOCKED lets several reconcilers run without double-processing. */
export async function claimOutbox(db: Db, limit = 20) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(workflowOutbox)
      .where(and(eq(workflowOutbox.status, 'pending'), lte(workflowOutbox.availableAt, new Date())))
      .orderBy(asc(workflowOutbox.createdAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (!rows.length) return [];
    await tx
      .update(workflowOutbox)
      .set({ availableAt: new Date(Date.now() + 60_000), attempts: sql`${workflowOutbox.attempts} + 1` })
      .where(inArray(workflowOutbox.id, rows.map((r) => r.id)));
    return rows;
  });
}

export async function completeOutbox(db: DbOrTx, id: string) {
  await db.update(workflowOutbox).set({ status: 'done', processedAt: new Date(), lastError: null }).where(eq(workflowOutbox.id, id));
}

export async function failOutbox(db: DbOrTx, id: string, attempts: number, error: string, maxAttempts = 50) {
  const backoffMs = Math.min(5 * 60_000, 1000 * 2 ** Math.min(attempts, 8));
  await db
    .update(workflowOutbox)
    .set({ status: attempts >= maxAttempts ? 'dead' : 'pending', lastError: error.slice(0, 500), availableAt: new Date(Date.now() + backoffMs) })
    .where(eq(workflowOutbox.id, id));
}

export async function listNonTerminalTasks(db: DbOrTx, olderThan: Date, limit = 50) {
  return db
    .select({ id: tasks.id, ownerId: tasks.ownerId, workflowId: tasks.workflowId, status: tasks.status })
    .from(tasks)
    .where(and(inArray(tasks.status, ['queued', 'running', 'waiting_approval']), lte(tasks.updatedAt, olderThan)))
    .limit(limit);
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
