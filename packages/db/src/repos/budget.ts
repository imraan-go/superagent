import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { nanosToUsd } from '@superagent/observability';
import type { Db, DbOrTx } from '../client';
import { BudgetExceededError } from '../errors';
import { budgetReservations, usageEntries, userSettings } from '../schema';

export interface BudgetLimits {
  perRunNanos: bigint | null;
  monthlyNanos: bigint | null;
}

export async function getBudgetLimits(db: DbOrTx, ownerId: string, defaults: BudgetLimits): Promise<BudgetLimits> {
  const rows = await db.select().from(userSettings).where(eq(userSettings.ownerId, ownerId)).limit(1);
  const s = rows[0];
  // The user's own settings may only tighten the installation-wide caps, never raise them.
  const tighten = (a: bigint | null | undefined, b: bigint | null) => (a == null ? b : b == null ? a : a < b ? a : b);
  return { perRunNanos: tighten(s?.maxCostPerRunNanos, defaults.perRunNanos), monthlyNanos: tighten(s?.monthlyLimitNanos, defaults.monthlyNanos) };
}

export function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const committed = sql<string>`coalesce(sum(coalesce(${budgetReservations.actualNanos}, ${budgetReservations.amountNanos})), 0)`;

export interface ReserveInput {
  ownerId: string;
  taskId: string | null;
  dedupeKey: string;
  amountNanos: bigint;
  limits: BudgetLimits;
}

/**
 * Atomically reserves an estimated maximum cost before a paid call. Serialized per owner with a
 * transaction-scoped advisory lock (released at commit; safe with pooled connections). Idempotent
 * per dedupeKey so Activity retries do not double-reserve. Estimates are not a vendor invoice cap.
 */
export async function reserveBudget(db: Db, input: ReserveInput) {
  if (input.limits.perRunNanos == null || input.limits.monthlyNanos == null) {
    throw new BudgetExceededError('Live execution requires MAX_COST_PER_RUN and MONTHLY_COST_LIMIT to be set.');
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.ownerId}, 0))`);
    const existing = await tx.select().from(budgetReservations).where(eq(budgetReservations.dedupeKey, input.dedupeKey)).limit(1);
    if (existing[0]) return existing[0];
    const active = inArray(budgetReservations.status, ['reserved', 'settled']);
    const [month] = await tx
      .select({ total: committed })
      .from(budgetReservations)
      .where(and(eq(budgetReservations.ownerId, input.ownerId), active, gte(budgetReservations.createdAt, monthStartUtc())));
    const monthTotal = BigInt(month?.total ?? '0');
    if (monthTotal + input.amountNanos > input.limits.monthlyNanos!) {
      throw new BudgetExceededError(`Monthly limit ${nanosToUsd(input.limits.monthlyNanos!)} USD would be exceeded (committed ${nanosToUsd(monthTotal)} USD).`);
    }
    if (input.taskId) {
      const [run] = await tx
        .select({ total: committed })
        .from(budgetReservations)
        .where(and(eq(budgetReservations.ownerId, input.ownerId), eq(budgetReservations.taskId, input.taskId), active));
      const runTotal = BigInt(run?.total ?? '0');
      if (runTotal + input.amountNanos > input.limits.perRunNanos!) {
        throw new BudgetExceededError(`Per-run limit ${nanosToUsd(input.limits.perRunNanos!)} USD would be exceeded (committed ${nanosToUsd(runTotal)} USD).`);
      }
    }
    const [row] = await tx
      .insert(budgetReservations)
      .values({ ownerId: input.ownerId, taskId: input.taskId, dedupeKey: input.dedupeKey, amountNanos: input.amountNanos })
      .returning();
    return row!;
  });
}

/** actualNanos=null means billing is unknown: the reservation stays charged at its estimate. */
export async function settleReservation(db: DbOrTx, dedupeKey: string, actualNanos: bigint | null) {
  await db
    .update(budgetReservations)
    .set({ status: 'settled', actualNanos: actualNanos ?? sql`${budgetReservations.amountNanos}`, settledAt: new Date() })
    .where(and(eq(budgetReservations.dedupeKey, dedupeKey), eq(budgetReservations.status, 'reserved')));
}

/** Only for calls that provably never reached the provider. */
export async function releaseReservation(db: DbOrTx, dedupeKey: string) {
  await db
    .update(budgetReservations)
    .set({ status: 'released', actualNanos: 0n, settledAt: new Date() })
    .where(and(eq(budgetReservations.dedupeKey, dedupeKey), eq(budgetReservations.status, 'reserved')));
}

export async function recordUsage(db: DbOrTx, entry: typeof usageEntries.$inferInsert) {
  await db.insert(usageEntries).values(entry).onConflictDoNothing({ target: usageEntries.dedupeKey });
}

export async function usageSummary(db: DbOrTx, ownerId: string, since = monthStartUtc()) {
  const rows = await db
    .select({
      kind: usageEntries.kind,
      costStatus: usageEntries.costStatus,
      total: sql<string>`coalesce(sum(${usageEntries.costNanos}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(usageEntries)
    .where(and(eq(usageEntries.ownerId, ownerId), gte(usageEntries.createdAt, since)))
    .groupBy(usageEntries.kind, usageEntries.costStatus);
  const [reserved] = await db
    .select({ total: committed })
    .from(budgetReservations)
    .where(and(eq(budgetReservations.ownerId, ownerId), inArray(budgetReservations.status, ['reserved', 'settled']), gte(budgetReservations.createdAt, since)));
  return {
    currency: 'USD' as const,
    since: since.toISOString(),
    committedUsd: nanosToUsd(BigInt(reserved?.total ?? '0')),
    byKind: rows.map((r) => ({ kind: r.kind, costStatus: r.costStatus, usd: nanosToUsd(BigInt(r.total)), count: r.count })),
  };
}
