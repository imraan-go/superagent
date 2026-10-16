import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { scheduleTemporalId, type ScheduleSpecInput } from '@superagent/contracts';
import type { Db } from '../client';
import { NotFoundError } from '../errors';
import { schedules } from '../schema';
import { enqueueOutbox } from './tasks';
import { getScheduleForOwner } from './resources';

export interface CreateScheduleInput {
  ownerId: string;
  name: string;
  prompt: string;
  spec: ScheduleSpecInput;
  timezone: string;
  allowedDomains: string[];
  catchupWindowMinutes: number;
  chatId?: string | null;
}

/**
 * One code path for routines, whether created from the Schedules UI or by the agent in chat:
 * the row and its `create_schedule` outbox entry commit together; the reconciler then creates the
 * Temporal Schedule (overlap SKIP, catch-up window). Scheduled runs are always read-only.
 */
export async function createScheduleWithOutbox(db: Db, input: CreateScheduleInput) {
  const id = randomUUID();
  return db.transaction(async (tx) => {
    const [s] = await tx
      .insert(schedules)
      .values({
        id,
        ownerId: input.ownerId,
        name: input.name,
        prompt: input.prompt,
        spec: input.spec,
        timezone: input.timezone,
        allowedDomains: input.allowedDomains,
        readOnly: true,
        overlapPolicy: 'SKIP',
        catchupWindowSeconds: input.catchupWindowMinutes * 60,
        temporalScheduleId: scheduleTemporalId(id),
        state: 'pending_create',
        chatId: input.chatId ?? null,
      })
      .returning();
    await enqueueOutbox(tx, { ownerId: input.ownerId, kind: 'create_schedule', refId: id, payload: { scheduleId: id } });
    return s!;
  });
}

export type ScheduleTransition = 'pause' | 'resume' | 'delete';

const TRANSITIONS = {
  pause: { kind: 'pause_schedule', state: 'paused' },
  resume: { kind: 'resume_schedule', state: 'active' },
  delete: { kind: 'delete_schedule', state: 'deleted' },
} as const;

export async function transitionSchedule(db: Db, ownerId: string, id: string, t: ScheduleTransition) {
  const s = await getScheduleForOwner(db, ownerId, id);
  if (s.state === 'deleted') throw new NotFoundError('schedule');
  const { kind, state } = TRANSITIONS[t];
  await db.transaction(async (tx) => {
    await tx.update(schedules).set({ state, updatedAt: new Date() }).where(and(eq(schedules.id, s.id), eq(schedules.ownerId, ownerId)));
    await enqueueOutbox(tx, { ownerId, kind, refId: s.id, payload: { scheduleId: s.id } });
  });
  return { schedule: s, state };
}

export function describeSpec(spec: ScheduleSpecInput): string {
  return spec.kind === 'cron' ? `cron ${spec.cron}` : `every ${spec.everyMinutes} min`;
}
