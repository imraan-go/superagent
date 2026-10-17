import { readFileSync } from 'node:fs';
import {
  Client,
  Connection,
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
} from '@temporalio/client';
import { getEnv, type AppEnv } from '@superagent/config';
import {
  APPROVAL_SIGNAL,
  QUESTION_SIGNAL,
  RETENTION_WORKFLOW_TYPE,
  SCHEDULED_WORKFLOW_TYPE,
  TASK_WORKFLOW_TYPE,
  taskWorkflowId,
  type AgentTaskInput,
  type ScheduledTaskInput,
  type ScheduleSpecInput,
} from '@superagent/contracts';

export interface TemporalConnectionSettings {
  address: string;
  namespace: string;
  taskQueue: string;
  tls?: boolean | { clientCertPair: { crt: Buffer; key: Buffer } };
  apiKey?: string;
  mode: 'local' | 'cloud';
}

/** Mode validation already ran in config (cloud needs endpoint + namespace + API key or mTLS). */
export function temporalSettings(env: AppEnv = getEnv()): TemporalConnectionSettings {
  const base = {
    address: env.TEMPORAL_ADDRESS,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    mode: env.TEMPORAL_MODE,
  };
  if (env.TEMPORAL_MODE === 'local') return base;
  if (env.TEMPORAL_API_KEY) return { ...base, tls: true, apiKey: env.TEMPORAL_API_KEY };
  return {
    ...base,
    tls: {
      clientCertPair: { crt: readFileSync(env.TEMPORAL_TLS_CERT_PATH!), key: readFileSync(env.TEMPORAL_TLS_KEY_PATH!) },
    },
  };
}

let clientPromise: Promise<Client> | undefined;

export function getTemporalClient(): Promise<Client> {
  clientPromise ??= (async () => {
    const s = temporalSettings();
    const connection = await Connection.connect({
      address: s.address,
      ...(s.tls !== undefined ? { tls: s.tls } : {}),
      ...(s.apiKey ? { apiKey: s.apiKey } : {}),
      connectTimeout: '5s',
    });
    return new Client({ connection, namespace: s.namespace });
  })().catch((err) => {
    clientPromise = undefined;
    throw err;
  });
  return clientPromise;
}

/**
 * Idempotent start: the workflow id is derived from the task id and duplicates are rejected, so an
 * outbox retry or reconciler pass never creates a second execution for the same task.
 */
export async function startTaskWorkflow(
  client: Client,
  taskQueue: string,
  input: AgentTaskInput,
): Promise<'started' | 'already_started'> {
  try {
    await client.workflow.start(TASK_WORKFLOW_TYPE, {
      taskQueue,
      workflowId: taskWorkflowId(input.taskId),
      args: [input],
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      memo: { ownerRef: input.ownerId.slice(0, 8) },
    });
    return 'started';
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) return 'already_started';
    throw err;
  }
}

/** The signal carries only the intent id; the workflow re-validates the persisted approval via an Activity. */
export async function signalApproval(
  client: Client,
  taskId: string,
  intentId: string,
): Promise<'signalled' | 'not_running'> {
  try {
    await client.workflow.getHandle(taskWorkflowId(taskId)).signal(APPROVAL_SIGNAL, { intentId });
    return 'signalled';
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) return 'not_running';
    throw err;
  }
}

/** The signal carries only the question id; the workflow re-reads the persisted answer via an Activity. */
export async function signalQuestion(
  client: Client,
  taskId: string,
  questionId: string,
): Promise<'signalled' | 'not_running'> {
  try {
    await client.workflow.getHandle(taskWorkflowId(taskId)).signal(QUESTION_SIGNAL, { questionId });
    return 'signalled';
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) return 'not_running';
    throw err;
  }
}

export async function cancelTaskWorkflow(client: Client, taskId: string): Promise<'cancel_requested' | 'not_running'> {
  try {
    await client.workflow.getHandle(taskWorkflowId(taskId)).cancel();
    return 'cancel_requested';
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) return 'not_running';
    throw err;
  }
}

export type WorkflowState =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'terminated'
  | 'timed_out'
  | 'continued'
  | 'missing';

export async function describeTaskWorkflow(client: Client, taskId: string): Promise<WorkflowState> {
  try {
    const d = await client.workflow.getHandle(taskWorkflowId(taskId)).describe();
    const map: Record<string, WorkflowState> = {
      RUNNING: 'running',
      COMPLETED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
      TERMINATED: 'terminated',
      TIMED_OUT: 'timed_out',
      CONTINUED_AS_NEW: 'continued',
    };
    return map[d.status.name] ?? 'running';
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) return 'missing';
    throw err;
  }
}

export interface ScheduleDefinition {
  temporalScheduleId: string;
  scheduleId: string;
  ownerId: string;
  spec: ScheduleSpecInput;
  timezone: string;
  catchupWindowSeconds: number;
  paused?: boolean;
}

/**
 * Creates the Temporal Schedule for an app schedule. Overlap SKIP (a run never overlaps the
 * previous one), bounded catch-up after downtime, IANA timezone evaluated by Temporal (DST-aware).
 * Idempotent: an existing schedule with the same id is treated as created.
 */
export async function createTemporalSchedule(
  client: Client,
  taskQueue: string,
  def: ScheduleDefinition,
): Promise<'created' | 'exists'> {
  const spec =
    def.spec.kind === 'cron'
      ? { cronExpressions: [def.spec.cron], timezone: def.timezone }
      : { intervals: [{ every: `${def.spec.everyMinutes} minutes` as const }], timezone: def.timezone };
  try {
    await client.schedule.create({
      scheduleId: def.temporalScheduleId,
      spec,
      action: {
        type: 'startWorkflow',
        workflowType: SCHEDULED_WORKFLOW_TYPE,
        taskQueue,
        workflowId: `sched-run-${def.scheduleId}`,
        args: [{ scheduleId: def.scheduleId, ownerId: def.ownerId } satisfies ScheduledTaskInput],
      },
      policies: {
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: `${def.catchupWindowSeconds} seconds`,
        pauseOnFailure: false,
      },
      state: { paused: def.paused ?? false },
    });
    return 'created';
  } catch (err) {
    if (err instanceof ScheduleAlreadyRunning) return 'exists';
    throw err;
  }
}

export async function setTemporalSchedulePaused(
  client: Client,
  temporalScheduleId: string,
  paused: boolean,
): Promise<'ok' | 'missing'> {
  try {
    const h = client.schedule.getHandle(temporalScheduleId);
    if (paused) await h.pause('paused by owner');
    else await h.unpause('resumed by owner');
    return 'ok';
  } catch (err) {
    if (err instanceof ScheduleNotFoundError) return 'missing';
    throw err;
  }
}

export async function deleteTemporalSchedule(
  client: Client,
  temporalScheduleId: string,
): Promise<'deleted' | 'missing'> {
  try {
    await client.schedule.getHandle(temporalScheduleId).delete();
    return 'deleted';
  } catch (err) {
    if (err instanceof ScheduleNotFoundError) return 'missing';
    throw err;
  }
}

export async function describeTemporalSchedule(client: Client, temporalScheduleId: string) {
  try {
    const d = await client.schedule.getHandle(temporalScheduleId).describe();
    return {
      paused: d.state.paused,
      nextActionTimes: d.info.nextActionTimes.slice(0, 5).map((t) => t.toISOString()),
      recentActions: d.info.recentActions.length,
    };
  } catch (err) {
    if (err instanceof ScheduleNotFoundError) return null;
    throw err;
  }
}

export const RETENTION_SCHEDULE_ID = 'superagent-retention-daily';

export async function ensureRetentionSchedule(client: Client, taskQueue: string): Promise<'created' | 'exists'> {
  try {
    await client.schedule.create({
      scheduleId: RETENTION_SCHEDULE_ID,
      spec: { cronExpressions: ['17 3 * * *'], timezone: 'UTC' },
      action: {
        type: 'startWorkflow',
        workflowType: RETENTION_WORKFLOW_TYPE,
        taskQueue,
        workflowId: 'retention-run',
        args: [],
      },
      policies: { overlap: ScheduleOverlapPolicy.SKIP, catchupWindow: '1 hour' },
    });
    return 'created';
  } catch (err) {
    if (err instanceof ScheduleAlreadyRunning) return 'exists';
    throw err;
  }
}

export { WorkflowNotFoundError };
