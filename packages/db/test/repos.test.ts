import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  ApprovalError,
  BudgetExceededError,
  NotFoundError,
  acquireWorkspaceLease,
  appendEvent,
  beginAttempt,
  checkApproval,
  claimOutbox,
  createIntent,
  createMemory,
  createPendingConnection,
  createTaskWithOutbox,
  decideIntent,
  deleteMemory,
  finishAttempt,
  getArtifactForOwner,
  getConnectionForOwner,
  getIntentForOwner,
  getOrCreateWorkspaceRow,
  getScheduleForOwner,
  getTaskForOwner,
  insertArtifact,
  listEvents,
  listMemories,
  reserveBudget,
  settleReservation,
  setTaskStatus,
  updateMemory,
  type Db,
} from '../src/index';
import * as schema from '../src/schema';
import { createTestDb, createUser } from './helpers';

let db: Db;
let close: () => Promise<void>;
const ALICE = 'alice';
const BOB = 'bob';

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await createUser(db, ALICE);
  await createUser(db, BOB);
});
afterAll(async () => close());

async function newTask(owner = ALICE, key?: string) {
  return (await createTaskWithOutbox(db, { ownerId: owner, prompt: 'hello', allowedDomains: [], idempotencyKey: key, retentionDays: 30 })).task;
}

async function newIntent(owner = ALICE, expiryMs = 60_000) {
  const task = await newTask(owner);
  return createIntent(db, {
    ownerId: owner,
    taskId: task.id,
    toolCallId: `${task.id}:call1`,
    toolSlug: 'GMAIL_SEND_EMAIL',
    toolVersion: '20260101_00',
    connectedAccountId: null,
    args: { recipient_email: 'test@example.com', subject: 'Hi', body: 'Body' },
    destination: { recipient_email: 'test@example.com' },
    attachments: [],
    expiryMs,
  });
}

describe('task creation + outbox', () => {
  it('is idempotent per owner idempotency key and enqueues exactly one start', async () => {
    const a = await createTaskWithOutbox(db, { ownerId: ALICE, prompt: 'p', allowedDomains: [], idempotencyKey: 'idem-key-123', retentionDays: 30 });
    const b = await createTaskWithOutbox(db, { ownerId: ALICE, prompt: 'p', allowedDomains: [], idempotencyKey: 'idem-key-123', retentionDays: 30 });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.task.id).toBe(a.task.id);
    const outbox = await db.select().from(schema.workflowOutbox).where(eq(schema.workflowOutbox.refId, a.task.id));
    expect(outbox).toHaveLength(1);
    expect(a.task.workflowId).toBe(`task-${a.task.id}`);
  });

  it('same idempotency key for a different owner is a different task', async () => {
    const a = await createTaskWithOutbox(db, { ownerId: ALICE, prompt: 'p', allowedDomains: [], idempotencyKey: 'shared-key-1', retentionDays: 30 });
    const b = await createTaskWithOutbox(db, { ownerId: BOB, prompt: 'p', allowedDomains: [], idempotencyKey: 'shared-key-1', retentionDays: 30 });
    expect(a.task.id).not.toBe(b.task.id);
  });

  it('claims pending outbox rows once (lease pushes availability forward)', async () => {
    await newTask();
    const first = await claimOutbox(db, 100);
    const second = await claimOutbox(db, 100);
    expect(first.length).toBeGreaterThan(0);
    expect(second.map((r) => r.id)).not.toEqual(expect.arrayContaining(first.map((r) => r.id)));
  });

  it('terminal status is sticky', async () => {
    const t = await newTask();
    expect(await setTaskStatus(db, ALICE, t.id, 'completed')).toBe(true);
    expect(await setTaskStatus(db, ALICE, t.id, 'running')).toBe(false);
    expect((await getTaskForOwner(db, ALICE, t.id)).status).toBe('completed');
  });
});

describe('cross-user access denial', () => {
  it('task and events', async () => {
    const t = await newTask(ALICE);
    await appendEvent(db, { ownerId: ALICE, taskId: t.id, type: 'task.started', dedupeKey: 'x' });
    await expect(getTaskForOwner(db, BOB, t.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listEvents(db, BOB, t.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setTaskStatus(db, BOB, t.id, 'cancelled')).resolves.toBe(false);
  });

  it('approval intents cannot be read or decided by another user', async () => {
    const i = await newIntent(ALICE);
    await expect(getIntentForOwner(db, BOB, i.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(decideIntent(db, BOB, i.id, { decision: 'approved', argsHash: i.argsHash, nonce: i.nonce })).rejects.toBeInstanceOf(NotFoundError);
    await expect(beginAttempt(db, BOB, i.id, 'w')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('artifacts, connections, workspaces, schedules, memories', async () => {
    const t = await newTask(ALICE);
    const art = await insertArtifact(db, { ownerId: ALICE, taskId: t.id, name: 'a.txt', contentType: 'text/plain', sizeBytes: 1, sha256: 'x'.repeat(64), objectKey: `alice/${t.id}/a.txt`, expiresAt: new Date(Date.now() + 1e6) });
    await expect(getArtifactForOwner(db, BOB, art.id)).rejects.toBeInstanceOf(NotFoundError);
    const conn = await createPendingConnection(db, ALICE, 'github', null);
    await expect(getConnectionForOwner(db, BOB, conn.id)).rejects.toBeInstanceOf(NotFoundError);
    const ws = await getOrCreateWorkspaceRow(db, ALICE, 'code', 'user', 'tpl');
    await expect(acquireWorkspaceLease(db, BOB, ws.id, 'bob-worker', 1000)).resolves.toBeUndefined();
    const [sched] = await db
      .insert(schema.schedules)
      .values({ ownerId: ALICE, name: 's', prompt: 'p', spec: {}, timezone: 'UTC', temporalScheduleId: 'sched-x' })
      .returning();
    await expect(getScheduleForOwner(db, BOB, sched!.id)).rejects.toBeInstanceOf(NotFoundError);
    const mem = await createMemory(db, ALICE, 'likes tea', {});
    await expect(updateMemory(db, BOB, mem.id, 'hacked')).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteMemory(db, BOB, mem.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('malformed ids are not found rather than errors', async () => {
    await expect(getTaskForOwner(db, ALICE, "1' or '1'='1")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('approval binding', () => {
  it('rejects a stale/tampered argsHash and wrong nonce', async () => {
    const i = await newIntent();
    await expect(decideIntent(db, ALICE, i.id, { decision: 'approved', argsHash: 'f'.repeat(64), nonce: i.nonce })).rejects.toMatchObject({ code: 'hash_mismatch' });
    await expect(decideIntent(db, ALICE, i.id, { decision: 'approved', argsHash: i.argsHash, nonce: 'n'.repeat(32) })).rejects.toMatchObject({ code: 'nonce_mismatch' });
  });

  for (const [field, patch] of [
    ['recipient', { args: { recipient_email: 'attacker@evil.test', subject: 'Hi', body: 'Body' } }],
    ['body', { args: { recipient_email: 'test@example.com', subject: 'Hi', body: 'Changed' } }],
    ['tool version', { toolVersion: '20990101_00' }],
    ['attachments', { attachments: [{ sha256: 'a'.repeat(64), name: 'secret.pdf' }] }],
  ] as const) {
    it(`detects DB-level tampering of ${field} after intent creation`, async () => {
      const i = await newIntent();
      await db.update(schema.actionIntents).set(patch as object).where(eq(schema.actionIntents.id, i.id));
      await expect(decideIntent(db, ALICE, i.id, { decision: 'approved', argsHash: i.argsHash, nonce: i.nonce })).rejects.toMatchObject({ code: 'tampered' });
    });
  }

  it('tampering after approval blocks execution', async () => {
    const i = await newIntent();
    await decideIntent(db, ALICE, i.id, { decision: 'approved', argsHash: i.argsHash, nonce: i.nonce });
    await db.update(schema.actionIntents).set({ connectedAccountId: null, destination: { recipient_email: 'x@evil.test' } }).where(eq(schema.actionIntents.id, i.id));
    await expect(beginAttempt(db, ALICE, i.id, 'w1')).rejects.toBeInstanceOf(ApprovalError);
  });

  it('expired approvals cannot be decided', async () => {
    const i = await newIntent(ALICE, 1);
    await new Promise((r) => setTimeout(r, 1100));
    await expect(decideIntent(db, ALICE, i.id, { decision: 'approved', argsHash: i.argsHash, nonce: i.nonce })).rejects.toMatchObject({ code: 'expired' });
    expect(await checkApproval(db, ALICE, i.id)).toBe('expired');
  });

  it('a decision cannot be made twice', async () => {
    const i = await newIntent();
    await decideIntent(db, ALICE, i.id, { decision: 'rejected', argsHash: i.argsHash, nonce: i.nonce });
    await expect(decideIntent(db, ALICE, i.id, { decision: 'approved', argsHash: i.argsHash, nonce: i.nonce })).rejects.toMatchObject({ code: 'not_pending' });
    expect(await checkApproval(db, ALICE, i.id)).toBe('rejected');
    await expect(beginAttempt(db, ALICE, i.id, 'w')).rejects.toMatchObject({ code: 'not_approved' });
  });

  it('unapproved intents cannot be executed', async () => {
    const i = await newIntent();
    await expect(beginAttempt(db, ALICE, i.id, 'w')).rejects.toMatchObject({ code: 'not_approved' });
  });

  it('racing executions produce exactly one in-flight attempt', async () => {
    const i = await newIntent();
    await decideIntent(db, ALICE, i.id, { decision: 'approved', argsHash: i.argsHash, nonce: i.nonce });
    const results = await Promise.allSettled([beginAttempt(db, ALICE, i.id, 'w1'), beginAttempt(db, ALICE, i.id, 'w2'), beginAttempt(db, ALICE, i.id, 'w3')]);
    const go = results.filter((r) => r.status === 'fulfilled' && r.value.kind === 'go');
    expect(go).toHaveLength(1);
    expect(await finishAttempt(db, ALICE, i.id, 'unknown', { error: 'timeout' })).toBe(true);
    // A later retry sees the recorded outcome and never re-sends.
    expect(await beginAttempt(db, ALICE, i.id, 'w4')).toEqual({ kind: 'already', state: 'unknown' });
    expect(await finishAttempt(db, ALICE, i.id, 'confirmed', {})).toBe(false);
  });
});

describe('budget reservations', () => {
  const limits = { perRunNanos: 250_000_000n, monthlyNanos: 1_000_000_000n };

  it('refuses live execution without configured limits', async () => {
    await expect(reserveBudget(db, { ownerId: ALICE, taskId: null, dedupeKey: 'nolimit', amountNanos: 1n, limits: { perRunNanos: null, monthlyNanos: null } })).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('enforces per-run caps, is idempotent, and settles actuals', async () => {
    const t = await newTask(BOB);
    await reserveBudget(db, { ownerId: BOB, taskId: t.id, dedupeKey: 'r1', amountNanos: 200_000_000n, limits });
    await reserveBudget(db, { ownerId: BOB, taskId: t.id, dedupeKey: 'r1', amountNanos: 200_000_000n, limits });
    await expect(reserveBudget(db, { ownerId: BOB, taskId: t.id, dedupeKey: 'r2', amountNanos: 100_000_000n, limits })).rejects.toBeInstanceOf(BudgetExceededError);
    await settleReservation(db, 'r1', 1_000_000n);
    await expect(reserveBudget(db, { ownerId: BOB, taskId: t.id, dedupeKey: 'r3', amountNanos: 100_000_000n, limits })).resolves.toBeTruthy();
  });

  it('concurrent reservations cannot jointly exceed the monthly cap', async () => {
    const owner = 'carol';
    await createUser(db, owner);
    const lim = { perRunNanos: 10_000_000_000n, monthlyNanos: 500_000_000n };
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, k) => reserveBudget(db, { ownerId: owner, taskId: null, dedupeKey: `c${k}`, amountNanos: 100_000_000n, limits: lim })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
  });

  it('unknown billing keeps the estimate charged', async () => {
    const owner = 'dave';
    await createUser(db, owner);
    const lim = { perRunNanos: 10n ** 12n, monthlyNanos: 300n };
    await reserveBudget(db, { ownerId: owner, taskId: null, dedupeKey: 'u1', amountNanos: 200n, limits: lim });
    await settleReservation(db, 'u1', null);
    await expect(reserveBudget(db, { ownerId: owner, taskId: null, dedupeKey: 'u2', amountNanos: 200n, limits: lim })).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

describe('memory + leases', () => {
  it('memory deletion removes the row', async () => {
    const m = await createMemory(db, ALICE, 'prefers metric units', { taskId: null, source: 'user' });
    await deleteMemory(db, ALICE, m.id);
    expect((await listMemories(db, ALICE)).find((x) => x.id === m.id)).toBeUndefined();
  });

  it('one lease holder per workspace; expired leases can be taken over', async () => {
    const ws = await getOrCreateWorkspaceRow(db, ALICE, 'browser', 'lease-test', 'tpl');
    expect(await acquireWorkspaceLease(db, ALICE, ws.id, 'w1', 60_000)).toBeTruthy();
    expect(await acquireWorkspaceLease(db, ALICE, ws.id, 'w2', 60_000)).toBeUndefined();
    await db.update(schema.workspaces).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.workspaces.id, ws.id));
    expect(await acquireWorkspaceLease(db, ALICE, ws.id, 'w2', 60_000)).toBeTruthy();
  });
});
