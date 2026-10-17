/**
 * Transactional outbox + projection reconciliation against a real local Temporal dev server and
 * real Postgres semantics (PGlite with the production migrations). No worker polls the task queue,
 * so started workflows stay pending and nothing calls a model.
 */
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, Runtime } from '@temporalio/worker';
import { ScheduleOverlapPolicy } from '@temporalio/client';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { scheduleTemporalId, taskWorkflowId } from '@superagent/contracts';
import { claimOutbox, createTaskWithOutbox, enqueueOutbox, schema, type Db } from '@superagent/db';
import { createLogger } from '@superagent/observability';
import { describeTemporalSchedule } from '@superagent/temporal';
import { drainOutbox, processOutboxRow, reconcileProjections } from '../src/reconciler';
import { createTestDb, createUser } from '../../../packages/db/test/helpers';

const QUEUE = 'reconciler-int';
const log = createLogger('test');
let env: TestWorkflowEnvironment;
let db: Db;
let closeDb: () => Promise<void>;
let owner: string;

beforeAll(async () => {
  Runtime.install({ logger: new DefaultLogger('WARN') });
  const path = execSync('command -v temporal').toString().trim();
  env = await TestWorkflowEnvironment.createLocal({
    server: { executable: { type: 'existing-path', path }, ip: '127.0.0.1', ui: false },
  });
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

beforeEach(async () => {
  await closeDb?.();
  ({ db, close: closeDb } = await createTestDb());
  owner = await createUser(db, `u-${randomUUID().slice(0, 8)}`);
});

async function insertSchedule(spec: object, timezone: string) {
  const id = randomUUID();
  await db.insert(schema.schedules).values({
    id,
    ownerId: owner,
    name: 'weekly',
    prompt: 'summarise',
    spec,
    timezone,
    allowedDomains: [],
    readOnly: true,
    overlapPolicy: 'SKIP',
    catchupWindowSeconds: 600,
    temporalScheduleId: scheduleTemporalId(id),
    state: 'pending_create',
  });
  await enqueueOutbox(db, { ownerId: owner, kind: 'create_schedule', refId: id, payload: { scheduleId: id } });
  return id;
}

const setState = (id: string, state: string) =>
  db.update(schema.schedules).set({ state }).where(eq(schema.schedules.id, id));
const pendingOutbox = async () =>
  db.select().from(schema.workflowOutbox).where(eq(schema.workflowOutbox.status, 'pending'));

function localParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return { weekday: get('weekday'), hour: get('hour'), minute: get('minute') };
}

describe('outbox → Temporal schedules', () => {
  it('creates a DST-aware IANA-timezone schedule with overlap SKIP and bounded catch-up', async () => {
    const tz = 'America/Toronto';
    const id = await insertSchedule({ kind: 'cron', cron: '0 9 * * 0' }, tz);
    expect(await drainOutbox(db, env.client, QUEUE, log)).toBe(1);
    expect(await pendingOutbox()).toHaveLength(0);

    const [row] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, id));
    expect(row!.state).toBe('active');

    const d = await env.client.schedule.getHandle(scheduleTemporalId(id)).describe();
    expect(d.policies.overlap).toBe(ScheduleOverlapPolicy.SKIP);
    expect(d.policies.catchupWindow).toBe(600_000);
    expect(d.spec.timezone).toBe(tz);
    const next = d.info.nextActionTimes.slice(0, 6).map((t) => t.toISOString());
    expect(next.length).toBeGreaterThanOrEqual(5);
    // Every run is Sunday 09:00 Toronto wall-clock time, whichever UTC offset (EDT/EST) applies.
    for (const iso of next) expect(localParts(iso, tz)).toEqual({ weekday: 'Sun', hour: '09', minute: '00' });
    const utcHours = new Set(next.map((iso) => new Date(iso).getUTCHours()));
    for (const h of utcHours) expect([13, 14]).toContain(h);
  });

  it('pause/resume converge to the current DB state regardless of outbox processing order', async () => {
    const id = await insertSchedule({ kind: 'interval', everyMinutes: 60 }, 'Europe/London');
    await drainOutbox(db, env.client, QUEUE, log);

    // User pauses, resumes, then pauses again quickly: three rows, two kinds, unique per (kind, ref).
    await setState(id, 'paused');
    await enqueueOutbox(db, { ownerId: owner, kind: 'pause_schedule', refId: id });
    await setState(id, 'active');
    await enqueueOutbox(db, { ownerId: owner, kind: 'resume_schedule', refId: id });
    await setState(id, 'paused');
    await enqueueOutbox(db, { ownerId: owner, kind: 'pause_schedule', refId: id });
    await drainOutbox(db, env.client, QUEUE, log);
    expect((await describeTemporalSchedule(env.client, scheduleTemporalId(id)))?.paused).toBe(true);

    await setState(id, 'active');
    await enqueueOutbox(db, { ownerId: owner, kind: 'resume_schedule', refId: id });
    await drainOutbox(db, env.client, QUEUE, log);
    expect((await describeTemporalSchedule(env.client, scheduleTemporalId(id)))?.paused).toBe(false);
  });

  it('a pause processed before the create still yields one paused schedule; create is idempotent', async () => {
    const id = await insertSchedule({ kind: 'interval', everyMinutes: 30 }, 'Asia/Tokyo');
    await setState(id, 'paused');
    const [createRow] = await claimOutbox(db);
    await enqueueOutbox(db, { ownerId: owner, kind: 'pause_schedule', refId: id });
    const [pauseRow] = await db
      .select()
      .from(schema.workflowOutbox)
      .where(and(eq(schema.workflowOutbox.kind, 'pause_schedule'), eq(schema.workflowOutbox.refId, id)));
    await processOutboxRow(db, env.client, QUEUE, pauseRow!, log);
    await processOutboxRow(db, env.client, QUEUE, createRow!, log);
    await processOutboxRow(db, env.client, QUEUE, createRow!, log);
    expect((await describeTemporalSchedule(env.client, scheduleTemporalId(id)))?.paused).toBe(true);
  });

  it('delete removes the Temporal schedule and a late create does not resurrect it', async () => {
    const id = await insertSchedule({ kind: 'interval', everyMinutes: 15 }, 'UTC');
    const [createRow] = await claimOutbox(db);
    await processOutboxRow(db, env.client, QUEUE, createRow!, log);
    await setState(id, 'deleted');
    await enqueueOutbox(db, { ownerId: owner, kind: 'delete_schedule', refId: id });
    await drainOutbox(db, env.client, QUEUE, log);
    expect(await describeTemporalSchedule(env.client, scheduleTemporalId(id))).toBeNull();
    await processOutboxRow(db, env.client, QUEUE, createRow!, log);
    expect(await describeTemporalSchedule(env.client, scheduleTemporalId(id))).toBeNull();
  });
});

describe('outbox → task workflows and projection recovery', () => {
  const newTask = async () =>
    (await createTaskWithOutbox(db, { ownerId: owner, title: 't', prompt: 'p', allowedDomains: [], retentionDays: 30 }))
      .task;

  it('start_task is idempotent: a duplicate row never creates a second execution', async () => {
    const t = await newTask();
    const [row] = await claimOutbox(db);
    await processOutboxRow(db, env.client, QUEUE, row!, log);
    await processOutboxRow(db, env.client, QUEUE, row!, log);
    const runs = [];
    for await (const w of env.client.workflow.list({ query: `WorkflowId = '${taskWorkflowId(t.id)}'` }))
      runs.push(w.runId);
    expect(runs).toHaveLength(1);
    await env.client.workflow.getHandle(taskWorkflowId(t.id)).terminate('test cleanup');
  });

  it('cancel before the workflow exists marks the task cancelled with an event', async () => {
    const t = await newTask();
    await db.delete(schema.workflowOutbox);
    await enqueueOutbox(db, { ownerId: owner, kind: 'cancel_task', refId: t.id });
    await drainOutbox(db, env.client, QUEUE, log);
    const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, t.id));
    expect(row!.status).toBe('cancelled');
    const events = await db.select().from(schema.taskEvents).where(eq(schema.taskEvents.taskId, t.id));
    expect(events.map((e) => e.type)).toContain('task.cancelled');
  });

  it('re-enqueues a start for a queued task whose start was lost, and closes ghosts of terminated workflows', async () => {
    const lost = await newTask();
    const ghost = await newTask();
    await db.delete(schema.workflowOutbox);

    await env.client.workflow.start('agentTaskWorkflow', {
      taskQueue: QUEUE,
      workflowId: taskWorkflowId(ghost.id),
      args: [{ taskId: ghost.id, ownerId: owner }],
    });
    await db.update(schema.tasks).set({ status: 'running' }).where(eq(schema.tasks.id, ghost.id));
    await env.client.workflow.getHandle(taskWorkflowId(ghost.id)).terminate('operator terminated');

    const r = await reconcileProjections(db, env.client, log, 0);
    expect(r).toEqual({ restarted: 1, closed: 1 });
    const outbox = await pendingOutbox();
    expect(outbox.map((o) => [o.kind, o.refId])).toEqual([['start_task', lost.id]]);
    const [g] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, ghost.id));
    expect(g!.status).toBe('failed');
    expect(g!.error).toMatch(/terminated/);

    await drainOutbox(db, env.client, QUEUE, log);
    expect((await env.client.workflow.getHandle(taskWorkflowId(lost.id)).describe()).status.name).toBe('RUNNING');
    await env.client.workflow.getHandle(taskWorkflowId(lost.id)).terminate('test cleanup');
  });
});
