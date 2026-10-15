import { z } from 'zod';

export * from './workflow';

export const TaskStatus = z.enum(['queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatus>;

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'must be a hostname like example.com or *.example.com');

export const CreateTaskRequest = z.object({
  prompt: z.string().trim().min(1).max(8000),
  title: z.string().trim().max(200).optional(),
  allowedDomains: z.array(domain).max(20).default([]),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  timezone: z.string().trim().max(64).refine((tz) => isIanaTimezone(tz), 'must be an IANA timezone such as America/Toronto').optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export const ApprovalDecisionRequest = z.object({
  decision: z.enum(['approved', 'rejected']),
  argsHash: z.string().regex(/^[a-f0-9]{64}$/),
  nonce: z.string().min(16).max(128),
});
export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequest>;

export function isIanaTimezone(tz: string): boolean {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) && tz !== 'UTC') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const ScheduleSpecInput = z.union([
  z.object({ kind: z.literal('cron'), cron: z.string().trim().min(9).max(120) }),
  z.object({ kind: z.literal('interval'), everyMinutes: z.number().int().min(5).max(60 * 24 * 7) }),
]);

export type ScheduleSpecInput = z.infer<typeof ScheduleSpecInput>;

export const CreateScheduleRequest = z.object({
  name: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(4000),
  spec: ScheduleSpecInput,
  timezone: z.string().trim().min(1).max(64).refine(isIanaTimezone, 'must be an IANA timezone such as America/Toronto'),
  allowedDomains: z.array(domain).max(20).default([]),
  catchupWindowMinutes: z.number().int().min(1).max(24 * 60).default(10),
});
export type CreateScheduleRequest = z.infer<typeof CreateScheduleRequest>;

export const MemoryUpsertRequest = z.object({
  content: z.string().trim().min(1).max(2000),
});

export const ConnectRequest = z.object({
  toolkit: z.enum(['github', 'googlecalendar', 'googledrive', 'gmail', 'notion']),
});

export const BudgetSettingsRequest = z.object({
  maxCostPerRunUsd: z.string().regex(/^\d+(\.\d{1,6})?$/),
  monthlyLimitUsd: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

/** High-level, user-visible operational events. Never internal model reasoning. */
export const TaskEventType = z.enum([
  'task.queued',
  'task.started',
  'model.decision',
  'tool.started',
  'tool.completed',
  'tool.denied',
  'tool.failed',
  'approval.requested',
  'approval.decided',
  'approval.expired',
  'action.attempted',
  'action.confirmed',
  'action.failed',
  'action.unknown_outcome',
  'artifact.created',
  'workspace.created',
  'workspace.resumed',
  'workspace.adopted',
  'workspace.paused',
  'workspace.lost',
  'browser.started',
  'connection.expired',
  'budget.blocked',
  'task.completed',
  'task.failed',
  'task.cancelled',
]);
export type TaskEventType = z.infer<typeof TaskEventType>;

export interface TaskEventDTO {
  id: number;
  taskId: string;
  type: TaskEventType;
  data: Record<string, unknown>;
  createdAt: string;
}
