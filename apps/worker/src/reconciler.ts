import type { Client } from '@temporalio/client';
import { and, eq } from 'drizzle-orm';
import type { ScheduleSpecInput } from '@superagent/contracts';
import { appendEvent, claimOutbox, completeOutbox, failOutbox, listNonTerminalTasks, schema, setTaskStatus, enqueueOutbox, type Db } from '@superagent/db';
import type { Logger } from '@superagent/observability';
import {
  cancelTaskWorkflow,
  createTemporalSchedule,
  deleteTemporalSchedule,
  describeTaskWorkflow,
  setTemporalSchedulePaused,
  signalApproval,
  startTaskWorkflow,
} from '@superagent/temporal';

type OutboxRow = Awaited<ReturnType<typeof claimOutbox>>[number];

/**
 * Applies DB-committed intent to Temporal (transactional outbox). Every operation is idempotent on
 * the Temporal side (stable workflow/schedule ids), so at-least-once processing is safe.
 */
export async function processOutboxRow(db: Db, client: Client, taskQueue: string, row: OutboxRow, log: Logger): Promise<void> {
  const p = row.payload as Record<string, string>;
  switch (row.kind) {
    case 'start_task': {
      const r = await startTaskWorkflow(client, taskQueue, { taskId: row.refId, ownerId: row.ownerId });
      log.info('outbox.start_task', { taskId: row.refId, result: r });
      return;
    }
    case 'signal_approval': {
      const r = await signalApproval(client, p.taskId!, row.refId);
      log.info('outbox.signal_approval', { taskId: p.taskId, result: r });
      return;
    }
    case 'cancel_task': {
      const r = await cancelTaskWorkflow(client, row.refId);
      if (r === 'not_running') {
        if (await setTaskStatus(db, row.ownerId, row.refId, 'cancelled')) {
          await appendEvent(db, { ownerId: row.ownerId, taskId: row.refId, type: 'task.cancelled', dedupeKey: 'task.cancelled', data: { reason: 'cancelled before start' } });
        }
      }
      return;
    }
    case 'create_schedule':
    case 'pause_schedule':
    case 'resume_schedule':
    case 'delete_schedule': {
      // Rows of different kinds for one schedule can be processed in any order, so every row
      // converges Temporal to the schedule's *current* DB state instead of replaying its own kind.
      const rows = await db.select().from(schema.schedules).where(and(eq(schema.schedules.id, row.refId), eq(schema.schedules.ownerId, row.ownerId))).limit(1);
      const s = rows[0];
      if (!s) return;
      if (s.state === 'deleted') {
        await deleteTemporalSchedule(client, s.temporalScheduleId);
        return;
      }
      const paused = s.state === 'paused';
      const created = await createTemporalSchedule(client, taskQueue, {
        temporalScheduleId: s.temporalScheduleId,
        scheduleId: s.id,
        ownerId: s.ownerId,
        spec: s.spec as ScheduleSpecInput,
        timezone: s.timezone,
        catchupWindowSeconds: s.catchupWindowSeconds,
        paused,
      });
      if (created === 'exists') await setTemporalSchedulePaused(client, s.temporalScheduleId, paused);
      if (s.state === 'pending_create') {
        await db
          .update(schema.schedules)
          .set({ state: 'active', updatedAt: new Date() })
          .where(and(eq(schema.schedules.id, s.id), eq(schema.schedules.state, 'pending_create')));
      }
      log.info('outbox.schedule', { scheduleId: s.id, kind: row.kind, created, paused });
      return;
    }
    default:
      throw new Error(`unknown outbox kind ${row.kind}`);
  }
}

export async function drainOutbox(db: Db, client: Client, taskQueue: string, log: Logger): Promise<number> {
  const rows = await claimOutbox(db, 20);
  for (const row of rows) {
    try {
      await processOutboxRow(db, client, taskQueue, row, log);
      await completeOutbox(db, row.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('outbox.failed', { id: row.id, kind: row.kind, attempts: row.attempts + 1, error: msg });
      await failOutbox(db, row.id, row.attempts + 1, msg);
    }
  }
  return rows.length;
}

/**
 * Projection recovery: tasks stuck non-terminal in the DB are checked against Temporal. A task
 * whose workflow never started gets its start re-enqueued; a task whose workflow already closed
 * (e.g. terminated by an operator) is marked accordingly so the UI never shows a ghost "running".
 */
export async function reconcileProjections(db: Db, client: Client, log: Logger, staleMs = 120_000): Promise<{ restarted: number; closed: number }> {
  const stale = await listNonTerminalTasks(db, new Date(Date.now() - staleMs));
  let restarted = 0;
  let closed = 0;
  for (const t of stale) {
    const state = await describeTaskWorkflow(client, t.id);
    if (state === 'missing' && t.status === 'queued') {
      await enqueueOutbox(db, { ownerId: t.ownerId, kind: 'start_task', refId: t.id, payload: { taskId: t.id } });
      restarted++;
    } else if (state === 'missing' || state === 'failed' || state === 'terminated' || state === 'timed_out' || state === 'cancelled' || state === 'completed') {
      const status = state === 'cancelled' ? 'cancelled' : state === 'completed' ? 'completed' : 'failed';
      if (await setTaskStatus(db, t.ownerId, t.id, status, status === 'failed' ? { error: `workflow ${state}` } : {})) {
        await appendEvent(db, { ownerId: t.ownerId, taskId: t.id, type: `task.${status}`, dedupeKey: `task.${status}`, data: { reason: `reconciled: workflow ${state}` } });
        closed++;
      }
    } else {
      await db.update(schema.tasks).set({ updatedAt: new Date() }).where(eq(schema.tasks.id, t.id));
    }
  }
  if (restarted || closed) log.info('projection.reconciled', { restarted, closed });
  return { restarted, closed };
}
