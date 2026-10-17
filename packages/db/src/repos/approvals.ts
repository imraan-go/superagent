import { and, eq } from 'drizzle-orm';
import { intentHash, newNonce } from '@superagent/policy';
import type { Db, DbOrTx } from '../client';
import { ApprovalError, NotFoundError } from '../errors';
import { actionAttempts, actionIntents, approvals, workflowOutbox } from '../schema';
import { isUuid } from './tasks';

type Intent = typeof actionIntents.$inferSelect;

export interface CreateIntentInput {
  ownerId: string;
  taskId: string;
  toolCallId: string;
  toolSlug: string;
  toolVersion: string;
  connectedAccountId: string | null;
  args: unknown;
  destination: unknown;
  attachments: Array<{ sha256: string; name: string }>;
  expiryMs: number;
}

function bindingOf(
  i: Pick<
    Intent,
    | 'ownerId'
    | 'taskId'
    | 'toolSlug'
    | 'toolVersion'
    | 'connectedAccountId'
    | 'args'
    | 'destination'
    | 'attachments'
    | 'nonce'
    | 'expiresAt'
  >,
) {
  return intentHash({
    ownerId: i.ownerId,
    taskId: i.taskId,
    toolSlug: i.toolSlug,
    toolVersion: i.toolVersion,
    connectedAccountId: i.connectedAccountId,
    args: i.args,
    destination: i.destination,
    attachments: i.attachments as Array<{ sha256: string; name: string }>,
    nonce: i.nonce,
    expiresAtMs: i.expiresAt.getTime(),
  });
}

/** Idempotent per tool call: an Activity retry returns the same immutable intent. */
export async function createIntent(db: DbOrTx, input: CreateIntentInput): Promise<Intent> {
  const existing = await db
    .select()
    .from(actionIntents)
    .where(and(eq(actionIntents.toolCallId, input.toolCallId), eq(actionIntents.ownerId, input.ownerId)))
    .limit(1);
  if (existing[0]) return existing[0];
  const nonce = newNonce();
  // Millisecond precision: Postgres timestamptz stores microseconds, JS Date milliseconds.
  const expiresAt = new Date(Math.floor((Date.now() + input.expiryMs) / 1000) * 1000);
  const base = {
    ownerId: input.ownerId,
    taskId: input.taskId,
    toolSlug: input.toolSlug,
    toolVersion: input.toolVersion,
    connectedAccountId: input.connectedAccountId,
    args: input.args as object,
    destination: (input.destination ?? {}) as object,
    attachments: input.attachments,
    nonce,
    expiresAt,
  };
  const argsHash = bindingOf(base);
  const [row] = await db
    .insert(actionIntents)
    .values({ ...base, toolCallId: input.toolCallId, argsHash })
    .onConflictDoNothing({ target: actionIntents.toolCallId })
    .returning();
  if (row) return row;
  const again = await db.select().from(actionIntents).where(eq(actionIntents.toolCallId, input.toolCallId)).limit(1);
  return again[0]!;
}

export async function getIntentForOwner(db: DbOrTx, ownerId: string, intentId: string): Promise<Intent> {
  if (!isUuid(intentId)) throw new NotFoundError('action');
  const rows = await db
    .select()
    .from(actionIntents)
    .where(and(eq(actionIntents.id, intentId), eq(actionIntents.ownerId, ownerId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('action');
  return rows[0];
}

export async function listPendingIntents(db: DbOrTx, ownerId: string) {
  return db
    .select()
    .from(actionIntents)
    .where(and(eq(actionIntents.ownerId, ownerId), eq(actionIntents.status, 'pending_approval')));
}

/**
 * Records the user's decision. The client must echo the exact argsHash and nonce it displayed,
 * so an approval of a stale preview cannot authorize changed arguments.
 */
export async function decideIntent(
  db: Db,
  ownerId: string,
  intentId: string,
  d: { decision: 'approved' | 'rejected'; argsHash: string; nonce: string },
) {
  return db.transaction(async (tx) => {
    if (!isUuid(intentId)) throw new NotFoundError('action');
    const rows = await tx
      .select()
      .from(actionIntents)
      .where(and(eq(actionIntents.id, intentId), eq(actionIntents.ownerId, ownerId)))
      .for('update');
    const intent = rows[0];
    if (!intent) throw new NotFoundError('action');
    if (intent.status !== 'pending_approval') throw new ApprovalError('not_pending', `action is ${intent.status}`);
    if (intent.expiresAt.getTime() <= Date.now()) {
      await tx.update(actionIntents).set({ status: 'expired' }).where(eq(actionIntents.id, intentId));
      throw new ApprovalError('expired', 'approval window has expired');
    }
    if (bindingOf(intent) !== intent.argsHash)
      throw new ApprovalError('tampered', 'stored action no longer matches its hash');
    if (d.argsHash !== intent.argsHash)
      throw new ApprovalError('hash_mismatch', 'the action changed since it was displayed; review it again');
    if (d.nonce !== intent.nonce) throw new ApprovalError('nonce_mismatch', 'approval nonce does not match');
    await tx
      .insert(approvals)
      .values({ intentId, ownerId, decision: d.decision, argsHash: d.argsHash, nonce: d.nonce });
    await tx.update(actionIntents).set({ status: d.decision }).where(eq(actionIntents.id, intentId));
    await tx
      .insert(workflowOutbox)
      .values({ ownerId, kind: 'signal_approval', refId: intentId, payload: { taskId: intent.taskId, intentId } })
      .onConflictDoNothing({ target: [workflowOutbox.kind, workflowOutbox.refId] });
    return { taskId: intent.taskId, status: d.decision };
  });
}

export async function checkApproval(
  db: DbOrTx,
  ownerId: string,
  intentId: string,
): Promise<'approved' | 'rejected' | 'expired' | 'pending'> {
  const intent = await getIntentForOwner(db, ownerId, intentId);
  if (intent.status === 'approved' || intent.status === 'consumed') {
    const a = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.intentId, intentId), eq(approvals.ownerId, ownerId)))
      .limit(1);
    if (a[0]?.decision === 'approved' && a[0].argsHash === intent.argsHash && a[0].nonce === intent.nonce)
      return 'approved';
    return 'rejected';
  }
  if (intent.status === 'rejected') return 'rejected';
  if (intent.status === 'expired' || intent.expiresAt.getTime() <= Date.now()) return 'expired';
  return 'pending';
}

export async function expireIntent(db: DbOrTx, ownerId: string, intentId: string) {
  await db
    .update(actionIntents)
    .set({ status: 'expired' })
    .where(
      and(
        eq(actionIntents.id, intentId),
        eq(actionIntents.ownerId, ownerId),
        eq(actionIntents.status, 'pending_approval'),
      ),
    );
}

export type BeginAttempt = { kind: 'go'; intent: Intent } | { kind: 'already'; state: string };

/**
 * Single consumption: under a row lock, re-verifies the persisted approval and hash, inserts the
 * unique attempt row and marks the intent consumed. A second worker racing here sees 'already'.
 */
export async function beginAttempt(db: Db, ownerId: string, intentId: string, workerId: string): Promise<BeginAttempt> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(actionIntents)
      .where(and(eq(actionIntents.id, intentId), eq(actionIntents.ownerId, ownerId)))
      .for('update');
    const intent = rows[0];
    if (!intent) throw new NotFoundError('action');
    if (intent.status === 'consumed') {
      const att = await tx.select().from(actionAttempts).where(eq(actionAttempts.intentId, intentId)).limit(1);
      return { kind: 'already', state: att[0]?.state ?? 'unknown' };
    }
    if (intent.status !== 'approved') throw new ApprovalError('not_approved', `action is ${intent.status}`);
    if (bindingOf(intent) !== intent.argsHash)
      throw new ApprovalError('tampered', 'stored action no longer matches its hash');
    const a = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.intentId, intentId), eq(approvals.ownerId, ownerId)))
      .limit(1);
    if (!a[0] || a[0].decision !== 'approved' || a[0].argsHash !== intent.argsHash || a[0].nonce !== intent.nonce) {
      throw new ApprovalError('not_approved', 'no matching persisted approval');
    }
    if (intent.expiresAt.getTime() <= Date.now())
      throw new ApprovalError('expired', 'approval expired before execution');
    const inserted = await tx
      .insert(actionAttempts)
      .values({ intentId, ownerId, workerId, state: 'in_flight' })
      .onConflictDoNothing({ target: actionAttempts.intentId })
      .returning();
    if (!inserted.length) return { kind: 'already', state: 'in_flight' };
    await tx.update(actionIntents).set({ status: 'consumed' }).where(eq(actionIntents.id, intentId));
    return { kind: 'go', intent };
  });
}

export async function finishAttempt(
  db: DbOrTx,
  ownerId: string,
  intentId: string,
  state: 'confirmed' | 'failed' | 'unknown',
  detail: { receipt?: unknown; error?: string },
) {
  const rows = await db
    .update(actionAttempts)
    .set({
      state,
      finishedAt: new Date(),
      receipt: (detail.receipt ?? null) as object | null,
      error: detail.error?.slice(0, 1000) ?? null,
    })
    .where(
      and(
        eq(actionAttempts.intentId, intentId),
        eq(actionAttempts.ownerId, ownerId),
        eq(actionAttempts.state, 'in_flight'),
      ),
    )
    .returning({ id: actionAttempts.id });
  return rows.length > 0;
}

export async function getAttempt(db: DbOrTx, ownerId: string, intentId: string) {
  const rows = await db
    .select()
    .from(actionAttempts)
    .where(and(eq(actionAttempts.intentId, intentId), eq(actionAttempts.ownerId, ownerId)))
    .limit(1);
  return rows[0];
}
