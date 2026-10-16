import type { AgentActivities } from '@superagent/contracts/workflow';
import * as actions from './actions';
import type { Deps } from './deps';
import * as lifecycle from './lifecycle';
import { modelDecision } from './model';
import * as questions from './questions';
import * as tools from './tools';

export * from './deps';
export { ModelConfigError, budgetDefaults } from './model';
export { exposedTools, toolRegistry } from './registry';

/** Binds the Activity implementations to their dependencies (real or fake). */
export function createActivities(d: Deps): AgentActivities {
  return {
    loadTaskContext: (r) => lifecycle.loadTaskContext(d, r),
    modelDecision: (r) => modelDecision(d, r),
    evaluateProposal: (r) => tools.evaluateProposal(d, r),
    recordToolOutcome: (r) => tools.recordToolOutcome(d, r),
    executeTool: (r) => tools.executeTool(d, r),
    prepareForApprovalWait: (r) => actions.prepareForApprovalWait(d, r),
    checkApproval: (r) => actions.checkApproval(d, r),
    resumeAfterApproval: (r) => actions.resumeAfterApproval(d, r),
    executeApprovedAction: (r) => actions.executeApprovedAction(d, r),
    reconcileAttempt: (r) => actions.reconcileAttempt(d, r),
    recordApprovalOutcome: (r) => actions.recordApprovalOutcome(d, r),
    prepareForQuestionWait: (r) => questions.prepareForQuestionWait(d, r),
    checkQuestion: (r) => questions.checkQuestion(d, r),
    recordQuestionOutcome: (r) => questions.recordQuestionOutcome(d, r),
    finalizeTask: (f) => lifecycle.finalizeTask(d, f),
    releaseTaskResources: (r) => lifecycle.releaseTaskResources(d, r),
    createScheduledTask: (i) => lifecycle.createScheduledTask(d, i),
    runRetention: () => lifecycle.runRetention(d),
  };
}
