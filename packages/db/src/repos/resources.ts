import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import { NotFoundError } from '../errors';
import { artifacts, connectedAccounts, memories, schedules, userSettings, workspaces } from '../schema';
import { isUuid } from './tasks';

/* ---------- connected accounts ---------- */

/** Stable Composio identity derived server-side from the authenticated user; never client-supplied. */
export function composioUserIdFor(ownerId: string): string {
  return `sa_user_${ownerId}`;
}

export async function createPendingConnection(db: DbOrTx, ownerId: string, toolkit: string, authConfigId: string | null) {
  const [row] = await db.insert(connectedAccounts).values({ ownerId, toolkit, composioUserId: composioUserIdFor(ownerId), authConfigId, status: 'initiated' }).returning();
  return row!;
}

export async function getConnectionForOwner(db: DbOrTx, ownerId: string, id: string) {
  if (!isUuid(id)) throw new NotFoundError('connection');
  const rows = await db.select().from(connectedAccounts).where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.ownerId, ownerId))).limit(1);
  if (!rows[0]) throw new NotFoundError('connection');
  return rows[0];
}

export async function listConnections(db: DbOrTx, ownerId: string) {
  return db.select().from(connectedAccounts).where(eq(connectedAccounts.ownerId, ownerId)).orderBy(desc(connectedAccounts.createdAt));
}

export async function activeConnection(db: DbOrTx, ownerId: string, toolkit: string) {
  const rows = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.ownerId, ownerId), eq(connectedAccounts.toolkit, toolkit), eq(connectedAccounts.status, 'active')))
    .orderBy(desc(connectedAccounts.lastVerifiedAt))
    .limit(1);
  return rows[0];
}

export async function updateConnection(db: DbOrTx, ownerId: string, id: string, patch: Partial<typeof connectedAccounts.$inferInsert>) {
  await db
    .update(connectedAccounts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.ownerId, ownerId)));
}

/* ---------- workspaces + leases ---------- */

export async function getOrCreateWorkspaceRow(db: DbOrTx, ownerId: string, kind: 'code' | 'browser', scope: string, templateId: string) {
  await db.insert(workspaces).values({ ownerId, kind, scope, templateId, state: 'creating' }).onConflictDoNothing({ target: [workspaces.ownerId, workspaces.kind, workspaces.scope] });
  const rows = await db.select().from(workspaces).where(and(eq(workspaces.ownerId, ownerId), eq(workspaces.kind, kind), eq(workspaces.scope, scope))).limit(1);
  return rows[0]!;
}

/** One mutating holder per workspace. Expired leases can be taken over (crashed worker). */
export async function acquireWorkspaceLease(db: DbOrTx, ownerId: string, workspaceId: string, holder: string, ttlMs: number) {
  const rows = await db
    .update(workspaces)
    .set({ leaseHolder: holder, leaseExpiresAt: new Date(Date.now() + ttlMs), updatedAt: new Date() })
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.ownerId, ownerId),
        or(isNull(workspaces.leaseHolder), eq(workspaces.leaseHolder, holder), lt(workspaces.leaseExpiresAt, new Date())),
      ),
    )
    .returning();
  return rows[0];
}

export async function releaseWorkspaceLease(db: DbOrTx, ownerId: string, workspaceId: string, holder: string) {
  await db
    .update(workspaces)
    .set({ leaseHolder: null, leaseExpiresAt: null, updatedAt: new Date() })
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerId, ownerId), eq(workspaces.leaseHolder, holder)));
}

export async function updateWorkspace(db: DbOrTx, ownerId: string, workspaceId: string, patch: Partial<typeof workspaces.$inferInsert>) {
  await db
    .update(workspaces)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerId, ownerId)));
}

export async function addWorkspaceActiveMs(db: DbOrTx, ownerId: string, workspaceId: string, ms: number) {
  await db
    .update(workspaces)
    .set({ activeMsTotal: sql`${workspaces.activeMsTotal} + ${Math.max(0, Math.round(ms))}`, lastActiveAt: new Date() })
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerId, ownerId)));
}

export async function listWorkspaces(db: DbOrTx, ownerId?: string) {
  const q = db.select().from(workspaces);
  return ownerId ? q.where(eq(workspaces.ownerId, ownerId)) : q;
}

/* ---------- artifacts ---------- */

export async function insertArtifact(db: DbOrTx, a: typeof artifacts.$inferInsert) {
  const [row] = await db.insert(artifacts).values(a).onConflictDoNothing({ target: artifacts.objectKey }).returning();
  if (row) return row;
  const rows = await db.select().from(artifacts).where(eq(artifacts.objectKey, a.objectKey)).limit(1);
  return rows[0]!;
}

export async function getArtifactForOwner(db: DbOrTx, ownerId: string, id: string) {
  if (!isUuid(id)) throw new NotFoundError('artifact');
  const rows = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.id, id), eq(artifacts.ownerId, ownerId), isNull(artifacts.deletedAt)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('artifact');
  return rows[0];
}

export async function listArtifacts(db: DbOrTx, ownerId: string, taskId?: string) {
  const cond = [eq(artifacts.ownerId, ownerId), isNull(artifacts.deletedAt)];
  if (taskId) cond.push(eq(artifacts.taskId, taskId));
  return db.select().from(artifacts).where(and(...cond)).orderBy(desc(artifacts.createdAt)).limit(200);
}

export async function markArtifactDeleted(db: DbOrTx, ownerId: string, id: string) {
  await db.update(artifacts).set({ deletedAt: new Date() }).where(and(eq(artifacts.id, id), eq(artifacts.ownerId, ownerId)));
}

/* ---------- memories ---------- */

export async function listMemories(db: DbOrTx, ownerId: string) {
  return db.select().from(memories).where(eq(memories.ownerId, ownerId)).orderBy(desc(memories.updatedAt));
}

export async function createMemory(db: DbOrTx, ownerId: string, content: string, provenance: Record<string, unknown>) {
  const [row] = await db.insert(memories).values({ ownerId, content, provenance }).returning();
  return row!;
}

export async function updateMemory(db: DbOrTx, ownerId: string, id: string, content: string) {
  if (!isUuid(id)) throw new NotFoundError('memory');
  const rows = await db
    .update(memories)
    .set({ content, updatedAt: new Date(), provenance: sql`${memories.provenance} || '{"editedByUser": true}'::jsonb` })
    .where(and(eq(memories.id, id), eq(memories.ownerId, ownerId)))
    .returning();
  if (!rows[0]) throw new NotFoundError('memory');
  return rows[0];
}

/** Hard delete: memory is retained until the user deletes it, then removed from app storage. */
export async function deleteMemory(db: DbOrTx, ownerId: string, id: string) {
  if (!isUuid(id)) throw new NotFoundError('memory');
  const rows = await db.delete(memories).where(and(eq(memories.id, id), eq(memories.ownerId, ownerId))).returning({ id: memories.id });
  if (!rows[0]) throw new NotFoundError('memory');
}

/* ---------- schedules ---------- */

export async function getScheduleForOwner(db: DbOrTx, ownerId: string, id: string) {
  if (!isUuid(id)) throw new NotFoundError('schedule');
  const rows = await db.select().from(schedules).where(and(eq(schedules.id, id), eq(schedules.ownerId, ownerId))).limit(1);
  if (!rows[0]) throw new NotFoundError('schedule');
  return rows[0];
}

export async function listSchedules(db: DbOrTx, ownerId: string) {
  return db.select().from(schedules).where(and(eq(schedules.ownerId, ownerId), sql`${schedules.state} <> 'deleted'`)).orderBy(desc(schedules.createdAt));
}

/* ---------- settings ---------- */

export async function upsertSettings(db: DbOrTx, ownerId: string, patch: Partial<typeof userSettings.$inferInsert>) {
  await db
    .insert(userSettings)
    .values({ ownerId, ...patch })
    .onConflictDoUpdate({ target: userSettings.ownerId, set: { ...patch, updatedAt: new Date() } });
}

export async function getSettings(db: DbOrTx, ownerId: string) {
  const rows = await db.select().from(userSettings).where(eq(userSettings.ownerId, ownerId)).limit(1);
  return rows[0];
}
