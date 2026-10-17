import type {
  ActionOutcome,
  ApprovalCheck,
  DecisionResult,
  ProposalVerdict,
  TaskContextResult,
  TaskFinalization,
  ToolExecutionResult,
} from '@superagent/contracts/workflow';

/** Activity signatures as seen by workflow code (implemented in @superagent/activities). */
export interface TaskActivities {
  loadTaskContext(i: { taskId: string; ownerId: string }): Promise<TaskContextResult>;
  checkApproval(i: { ownerId: string; intentId: string }): Promise<ApprovalCheck>;
  recordApprovalOutcome(i: {
    taskId: string;
    ownerId: string;
    intentId: string;
    toolCallId: string;
    state: 'rejected' | 'expired' | 'pending';
  }): Promise<void>;
  recordLimit(i: { taskId: string; ownerId: string; toolCallId: string; reason: string }): Promise<void>;
  finalizeTask(i: TaskFinalization): Promise<void>;
  createScheduledTask(i: {
    scheduleId: string;
    ownerId: string;
    runKey: string;
  }): Promise<{ taskId: string | null; reason?: string }>;
  markWaitingApproval(i: { taskId: string; ownerId: string; intentId: string }): Promise<void>;
}

export interface ModelActivities {
  modelDecision(i: { taskId: string; ownerId: string; step: number }): Promise<DecisionResult>;
}

export interface PolicyActivities {
  evaluateProposal(i: {
    taskId: string;
    ownerId: string;
    toolCallId: string;
    readOnly: boolean;
  }): Promise<ProposalVerdict>;
}

export interface ToolActivities {
  executeTool(i: { taskId: string; ownerId: string; toolCallId: string }): Promise<ToolExecutionResult>;
}

export interface ActionActivities {
  executeApprovedAction(i: {
    taskId: string;
    ownerId: string;
    intentId: string;
    toolCallId: string;
  }): Promise<ActionOutcome>;
  reconcileAttempt(i: {
    taskId: string;
    ownerId: string;
    intentId: string;
    toolCallId: string;
    failure: string;
  }): Promise<ActionOutcome>;
}

export interface WorkspaceActivities {
  releaseWorkspaces(i: { taskId: string; ownerId: string; reason: 'approval_wait' | 'task_end' }): Promise<void>;
}

export interface MaintenanceActivities {
  purgeExpired(i: { nowMs: number }): Promise<{ tasks: number; artifacts: number; outbox: number; residual: string[] }>;
}
