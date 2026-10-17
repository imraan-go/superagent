/**
 * Types crossing the Temporal Workflow <-> Activity boundary.
 * Payloads carry references and operational metadata only: no tokens, email bodies,
 * screenshots or file contents. Sensitive content lives in Postgres/MinIO.
 */

export const TASK_QUEUE_DEFAULT = 'personal-agent';
export const APPROVAL_SIGNAL = 'approvalDecided';
export const QUESTION_SIGNAL = 'questionAnswered';
export const TASK_WORKFLOW_TYPE = 'agentTaskWorkflow';
export const SCHEDULED_WORKFLOW_TYPE = 'scheduledTaskWorkflow';
export const RETENTION_WORKFLOW_TYPE = 'retentionWorkflow';

export const taskWorkflowId = (taskId: string) => `task-${taskId}`;
export const scheduleTemporalId = (scheduleId: string) => `sched-${scheduleId}`;

export interface AgentTaskInput {
  taskId: string;
  ownerId: string;
  /** Carried across continue-as-new. */
  carry?: AgentCarryState;
}

export interface AgentCarryState {
  step: number;
  toolCalls: number;
  activeMs: number;
  pendingIntentIds: string[];
}

export interface Limits {
  maxDecisions: number;
  maxToolCalls: number;
  maxActiveMs: number;
  approvalExpiryMs: number;
}

export interface TaskContextResult {
  status: 'ready' | 'terminal';
  limits: Limits;
  readOnly: boolean;
}

export interface ToolProposalRef {
  toolCallId: string;
  toolName: string;
}

export type DecisionResult =
  | { kind: 'final'; step: number }
  | { kind: 'tools'; step: number; proposals: ToolProposalRef[] }
  | { kind: 'error'; step: number; reason: string };

export type ProposalVerdict =
  | { verdict: 'allow'; toolCallId: string; executor: 'local' | 'workspace' | 'browser' | 'connector' }
  | { verdict: 'deny'; toolCallId: string; reason: string }
  | { verdict: 'needs_approval'; toolCallId: string; intentId: string; expiresAtMs: number }
  /**
   * The user must answer in chat before this call completes: an `ask_user` question, or a
   * confirm-gated tool (`gate: true`) that only runs after an explicit Yes.
   */
  | { verdict: 'needs_answer'; toolCallId: string; questionId: string; expiresAtMs: number; gate: boolean };

export interface ToolExecutionResult {
  toolCallId: string;
  ok: boolean;
  summary: string;
}

export interface ApprovalSignal {
  intentId: string;
}

export interface QuestionSignal {
  questionId: string;
}

export type QuestionCheck =
  | { state: 'answered'; confirmed: boolean }
  | { state: 'expired' }
  | { state: 'pending' }
  | { state: 'cancelled' };

export type ApprovalCheck = { state: 'approved' } | { state: 'rejected' } | { state: 'expired' } | { state: 'pending' };

export type ActionOutcome = { state: 'confirmed' | 'failed' | 'unknown' | 'skipped'; summary: string };

export interface ScheduledTaskInput {
  scheduleId: string;
  ownerId: string;
}

export interface TaskFinalization {
  taskId: string;
  ownerId: string;
  status: 'completed' | 'failed' | 'cancelled';
  reason?: string;
}

export interface TaskRef {
  taskId: string;
  ownerId: string;
}

export interface ToolRef extends TaskRef {
  toolCallId: string;
}

export interface IntentRef extends ToolRef {
  intentId: string;
}

export interface QuestionRef extends ToolRef {
  questionId: string;
}

/** The Activity surface the deterministic workflows depend on (implemented in @superagent/activities). */
export interface AgentActivities {
  loadTaskContext(ref: TaskRef): Promise<TaskContextResult>;
  modelDecision(ref: TaskRef & { step: number }): Promise<DecisionResult>;
  evaluateProposal(ref: ToolRef & { readOnly: boolean }): Promise<ProposalVerdict>;
  recordToolOutcome(ref: ToolRef & { status: 'denied' | 'failed'; summary: string }): Promise<void>;
  executeTool(ref: ToolRef): Promise<ToolExecutionResult>;
  prepareForApprovalWait(ref: IntentRef): Promise<void>;
  checkApproval(ref: IntentRef): Promise<ApprovalCheck>;
  resumeAfterApproval(ref: TaskRef): Promise<void>;
  executeApprovedAction(ref: IntentRef): Promise<ActionOutcome>;
  reconcileAttempt(ref: IntentRef & { error: string }): Promise<ActionOutcome>;
  recordApprovalOutcome(ref: IntentRef & { state: 'rejected' | 'expired' }): Promise<void>;
  prepareForQuestionWait(ref: QuestionRef): Promise<void>;
  checkQuestion(ref: QuestionRef): Promise<QuestionCheck>;
  /** Writes the answer (or expiry/refusal) as the tool result; a confirmed gate re-allows the call. */
  recordQuestionOutcome(
    ref: QuestionRef & { gate: boolean; state: 'answered' | 'expired' | 'cancelled' },
  ): Promise<{ runGatedTool: boolean }>;
  finalizeTask(f: TaskFinalization): Promise<void>;
  releaseTaskResources(ref: TaskRef): Promise<void>;
  createScheduledTask(input: ScheduledTaskInput & { runKey: string }): Promise<{ taskId: string | null }>;
  runRetention(): Promise<{ tasks: number; artifacts: number }>;
}
