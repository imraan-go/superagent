import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { TaskContextResult, TaskFinalization, TaskRef, ScheduledTaskInput } from '@superagent/contracts/workflow';
import { appendChatMessage, createTaskWithOutbox, getScheduleForOwner, getTaskForOwner, runParts, schema, setTaskStatus, NotFoundError } from '@superagent/db';
import { emit, taskScope, type Deps } from './deps';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export async function loadTaskContext(d: Deps, ref: TaskRef): Promise<TaskContextResult> {
  const task = await getTaskForOwner(d.db, ref.ownerId, ref.taskId);
  const limits = {
    maxDecisions: d.env.MAX_MODEL_DECISIONS_PER_RUN,
    maxToolCalls: d.env.MAX_TOOL_CALLS_PER_RUN,
    maxActiveMs: d.env.MAX_ACTIVE_EXECUTION_MINUTES * 60_000,
    approvalExpiryMs: d.env.APPROVAL_EXPIRY_HOURS * 3_600_000,
  };
  if (TERMINAL.has(task.status)) return { status: 'terminal', limits, readOnly: task.readOnly };
  if (task.status === 'queued') await setTaskStatus(d.db, ref.ownerId, ref.taskId, 'running');
  await emit(d, ref.ownerId, ref.taskId, 'task.started', 'task.started', { origin: task.origin });
  return { status: 'ready', limits, readOnly: task.readOnly };
}

export async function finalizeTask(d: Deps, f: TaskFinalization) {
  const changed = await setTaskStatus(d.db, f.ownerId, f.taskId, f.status, f.reason ? { error: f.reason.slice(0, 2000) } : {});
  if (changed) await emit(d, f.ownerId, f.taskId, `task.${f.status}`, `task.${f.status}`, f.reason ? { reason: f.reason } : {});
  await postRunToChat(d, f);
}

/** The chat column's copy of a finished run (idempotent: one assistant turn per task). */
async function postRunToChat(d: Deps, f: TaskFinalization) {
  const task = await getTaskForOwner(d.db, f.ownerId, f.taskId);
  if (!task.chatId) return;
  const text =
    f.status === 'completed'
      ? (task.resultSummary ?? '').trim() || 'Done.'
      : f.status === 'cancelled'
        ? 'Stopped.'
        : `This run failed: ${(f.reason ?? task.error ?? 'unknown error').slice(0, 500)}`;
  const parts = await runParts(d.db, f.ownerId, f.taskId, text);
  await appendChatMessage(d.db, {
    ownerId: f.ownerId,
    chatId: task.chatId,
    role: 'assistant',
    taskId: task.id,
    model: task.model ?? d.env.AI_MODEL_PRIMARY ?? null,
    content: parts,
    dedupeKey: `final:${task.id}`,
  });
}

async function workspaceRows(d: Deps, ownerId: string, taskId: string) {
  return d.db
    .select()
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.ownerId, ownerId), inArray(schema.workspaces.scope, ['user', taskId]), inArray(schema.workspaces.state, ['running'])));
}

/** Pauses (not kills) live sandboxes before a long wait: files persist, no idle compute is billed. */
export async function pauseTaskWorkspaces(d: Deps, ref: TaskRef) {
  const configured = d.configured();
  if (!configured.has('e2b_code') && !configured.has('e2b_browser')) return;
  const rows = await workspaceRows(d, ref.ownerId, ref.taskId);
  await taskScope.run(ref, async () => {
    for (const r of rows) {
      if (r.kind === 'browser' && r.scope !== ref.taskId) continue;
      await d.workspaces().pause(ref.ownerId, r.kind as 'code' | 'browser', r.scope);
    }
  });
}

/** End of run: the disposable per-task browser is destroyed; the reusable code workspace is paused. */
export async function releaseTaskResources(d: Deps, ref: TaskRef) {
  const configured = d.configured();
  if (!configured.has('e2b_code') && !configured.has('e2b_browser')) return;
  const rows = await d.db
    .select()
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.ownerId, ref.ownerId), inArray(schema.workspaces.scope, ['user', ref.taskId])));
  await taskScope.run(ref, async () => {
    for (const r of rows) {
      try {
        if (r.kind === 'browser' && r.scope === ref.taskId && r.sandboxId) await d.workspaces().kill(ref.ownerId, 'browser', ref.taskId);
        else if (r.kind === 'code' && r.state === 'running') await d.workspaces().pause(ref.ownerId, 'code', 'user');
      } catch (err) {
        d.log.warn('release.failed', { taskId: ref.taskId, workspaceId: r.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}

export async function createScheduledTask(d: Deps, input: ScheduledTaskInput & { runKey: string }): Promise<{ taskId: string | null }> {
  let sched;
  try {
    sched = await getScheduleForOwner(d.db, input.ownerId, input.scheduleId);
  } catch (err) {
    if (err instanceof NotFoundError) return { taskId: null };
    throw err;
  }
  if (sched.state !== 'active') return { taskId: null };
  const { task } = await createTaskWithOutbox(d.db, {
    ownerId: input.ownerId,
    prompt: sched.prompt,
    title: `${sched.name} (scheduled)`,
    allowedDomains: sched.allowedDomains,
    idempotencyKey: `sched:${input.runKey}`,
    origin: 'schedule',
    scheduleId: sched.id,
    readOnly: sched.readOnly,
    timezone: sched.timezone,
    retentionDays: d.env.TASK_RETENTION_DAYS,
    chatId: sched.chatId,
  });
  if (sched.chatId) {
    await appendChatMessage(d.db, {
      ownerId: input.ownerId,
      chatId: sched.chatId,
      role: 'system',
      taskId: task.id,
      content: [{ type: 'text', text: `Routine “${sched.name}” is running.` }],
      dedupeKey: `routine:${task.id}`,
    });
  }
  return { taskId: task.id };
}

/**
 * Deletes app-side task content past retention: object-store artifacts first, then the task row
 * (messages, events, tool calls, intents cascade). Temporal history retention is configured
 * separately on the namespace (see docs/cost-and-retention.md).
 */
export async function runRetention(d: Deps): Promise<{ tasks: number; artifacts: number }> {
  const now = new Date();
  let artifactCount = 0;
  const expiredArtifacts = await d.db.select().from(schema.artifacts).where(and(lt(schema.artifacts.expiresAt, now), isNull(schema.artifacts.deletedAt))).limit(500);
  for (const a of expiredArtifacts) {
    try {
      await d.store().delete(a.objectKey);
      await d.db.update(schema.artifacts).set({ deletedAt: now }).where(eq(schema.artifacts.id, a.id));
      artifactCount++;
    } catch (err) {
      d.log.warn('retention.artifact_failed', { artifactId: a.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const expiredTasks = await d.db
    .select({ id: schema.tasks.id, ownerId: schema.tasks.ownerId })
    .from(schema.tasks)
    .where(and(lt(schema.tasks.expiresAt, now), inArray(schema.tasks.status, ['completed', 'failed', 'cancelled'])))
    .limit(200);
  let taskCount = 0;
  for (const t of expiredTasks) {
    const remaining = await d.db.select({ id: schema.artifacts.id }).from(schema.artifacts).where(and(eq(schema.artifacts.taskId, t.id), isNull(schema.artifacts.deletedAt))).limit(1);
    if (remaining.length) continue;
    const deleted = await d.db.delete(schema.tasks).where(and(eq(schema.tasks.id, t.id), eq(schema.tasks.ownerId, t.ownerId))).returning({ id: schema.tasks.id });
    taskCount += deleted.length;
  }
  await d.db.delete(schema.workflowOutbox).where(and(eq(schema.workflowOutbox.status, 'done'), lt(schema.workflowOutbox.processedAt, new Date(now.getTime() - d.env.OPERATIONAL_LOG_RETENTION_DAYS * 86_400_000))));
  return { tasks: taskCount, artifacts: artifactCount };
}
