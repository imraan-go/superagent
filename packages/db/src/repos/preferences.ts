import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import { userPreferences } from '../schema';

export async function getPreference(db: DbOrTx, ownerId: string, section: string): Promise<Record<string, unknown>> {
  const rows = await db
    .select()
    .from(userPreferences)
    .where(and(eq(userPreferences.ownerId, ownerId), eq(userPreferences.section, section)))
    .limit(1);
  return rows[0]?.value ?? {};
}

/** Merges `patch` into the stored section; a `null` value removes that key. Returns the result. */
export async function patchPreference(db: DbOrTx, ownerId: string, section: string, patch: Record<string, unknown>) {
  const next = { ...(await getPreference(db, ownerId, section)) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  await db
    .insert(userPreferences)
    .values({ ownerId, section, value: next })
    .onConflictDoUpdate({ target: [userPreferences.ownerId, userPreferences.section], set: { value: next, updatedAt: new Date() } });
  return next;
}

/** Replaces one section (already validated by the caller). */
export async function setPreference(db: DbOrTx, ownerId: string, section: string, value: Record<string, unknown>) {
  await db
    .insert(userPreferences)
    .values({ ownerId, section, value })
    .onConflictDoUpdate({ target: [userPreferences.ownerId, userPreferences.section], set: { value, updatedAt: new Date() } });
  return value;
}
