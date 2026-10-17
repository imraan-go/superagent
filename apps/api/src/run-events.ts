/**
 * Translates a task's operational events (task_events) into the chat UI's run wire protocol
 * (apps/web src/lib/run-events.ts). Pure: the SSE route feeds it rows in id order and writes
 * whatever frames come out, using the event id as the SSE id so reconnects resume exactly.
 */

export interface TaskEventRow {
  id: number;
  type: string;
  data: Record<string, unknown>;
  createdAt: Date | string;
}

export interface StepView {
  idx: number;
  type: 'think' | 'tool' | 'observe' | 'approval' | 'takeover' | 'waiting';
  toolName: string | null;
  label: string;
  ok: boolean | null;
  ms: number | null;
  preview?: string;
  images?: string[];
}

export type RunWireEvent =
  | { type: 'run_started'; runId: string; chatId: string; model: string }
  | { type: 'debug'; kind: string; data: Record<string, unknown> }
  | { type: 'step'; step: StepView }
  | { type: 'step_done'; step: StepView }
  | {
      type: 'approval_required';
      approvalId?: string;
      stepIdx: number;
      tool: string;
      reason: string;
      args: Record<string, unknown>;
    }
  | { type: 'approval_decided'; approvalId: string; tool: string; decision: 'approve' | 'reject' }
  | {
      type: 'question';
      question: {
        questionId: string;
        kind: string;
        prompt: string;
        options: Array<{ id: string; label: string }>;
        gate: boolean;
        expiresAt: string;
      };
    }
  | {
      type: 'question_resolved';
      questionId: string;
      status: 'answered' | 'expired';
      answer: { choices: string[]; text?: string } | null;
    }
  | { type: 'usage'; tokensIn: number; tokensOut: number; cached: number; costUsd: number }
  | { type: 'message'; message: Record<string, unknown> }
  | { type: 'done'; status: 'done' | 'cancelled' | 'paused_approval' }
  | { type: 'error'; code: string; message: string };

export interface TranslatorState {
  steps: Map<string, StepView>;
  stepStarted: Map<string, number>;
  usage: { tokensIn: number; tokensOut: number; cached: number; costUsd: number };
  approvals: Map<string, string>;
  nextIdx: number;
}

export function newTranslatorState(): TranslatorState {
  return {
    steps: new Map(),
    stepStarted: new Map(),
    usage: { tokensIn: 0, tokensOut: 0, cached: 0, costUsd: 0 },
    approvals: new Map(),
    nextIdx: 0,
  };
}

const TOOL_LABELS: Record<string, string> = {
  workspace_write_file: 'Writing a file',
  workspace_read_file: 'Reading a file',
  workspace_run_python: 'Running Python',
  workspace_export_file: 'Exporting a file',
  browser_navigate: 'Opening a page',
  browser_read: 'Reading the page',
  browser_screenshot: 'Taking a screenshot',
  browser_click: 'Clicking',
  browser_type: 'Typing',
  browser_scroll: 'Scrolling',
  browser_download: 'Downloading a file',
  browser_stop: 'Closing the browser',
  memory_save: 'Saving a memory',
  schedule_create: 'Creating a routine',
  schedule_list: 'Listing routines',
  schedule_pause: 'Pausing a routine',
  schedule_resume: 'Resuming a routine',
  schedule_delete: 'Deleting a routine',
};

export function toolLabel(tool: string): string {
  if (TOOL_LABELS[tool]) return TOOL_LABELS[tool];
  const pretty = tool
    .replace(/^[a-z]+__/, '')
    .replace(/_/g, ' ')
    .toLowerCase();
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function stepFor(s: TranslatorState, key: string, tool: string): StepView {
  let step = s.steps.get(key);
  if (!step) {
    step = { idx: s.nextIdx++, type: 'tool', toolName: tool, label: toolLabel(tool), ok: null, ms: null };
    s.steps.set(key, step);
  }
  return step;
}

/**
 * `finalMessage` is the chat's persisted assistant turn for this run, supplied by the route once
 * the run is terminal so the client can swap streamed state for the stored message.
 */
export function translate(
  s: TranslatorState,
  e: TaskEventRow,
  ctx: { runId: string; chatId: string; model: string; finalMessage?: Record<string, unknown> | null },
): RunWireEvent[] {
  const d = e.data ?? {};
  const at = new Date(e.createdAt).getTime();
  switch (e.type) {
    case 'task.queued':
      return [{ type: 'run_started', runId: ctx.runId, chatId: ctx.chatId, model: ctx.model }];
    case 'model.decision': {
      if (d.outcome === 'rejected_partial') return [{ type: 'debug', kind: 'model', data: d }];
      s.usage = {
        tokensIn: s.usage.tokensIn + num(d.inputTokens),
        tokensOut: s.usage.tokensOut + num(d.outputTokens),
        cached: s.usage.cached + num(d.cacheReadTokens),
        costUsd: s.usage.costUsd + Number(d.costUsd ?? 0),
      };
      return [
        { type: 'debug', kind: 'model', data: d },
        { type: 'usage', ...s.usage },
      ];
    }
    case 'tool.started': {
      const tool = str(d.tool);
      const step = stepFor(s, `${tool}#${s.steps.size}`, tool);
      s.stepStarted.set(tool, at);
      return [{ type: 'step', step: { ...step } }];
    }
    case 'tool.completed':
    case 'tool.failed':
    case 'tool.denied': {
      const tool = str(d.tool);
      const open = [...s.steps.values()].reverse().find((x) => x.toolName === tool && x.ok === null);
      const started = s.stepStarted.get(tool);
      const step = open ?? stepFor(s, `${tool}#${s.steps.size}`, tool);
      step.ok = e.type === 'tool.completed';
      step.ms = started ? Math.max(0, at - started) : null;
      step.preview = str(d.summary) || str(d.reason) || undefined;
      const out: RunWireEvent[] = open ? [] : [{ type: 'step', step: { ...step, ok: null } }];
      out.push({ type: 'step_done', step: { ...step } });
      return out;
    }
    case 'approval.requested': {
      const tool = str(d.tool);
      const step = stepFor(s, `approval:${str(d.intentId)}`, tool);
      step.type = 'approval';
      step.label = `Needs approval: ${toolLabel(tool)}`;
      s.approvals.set(str(d.intentId), tool);
      return [
        { type: 'step', step: { ...step } },
        {
          type: 'approval_required',
          approvalId: str(d.intentId),
          stepIdx: step.idx,
          tool,
          reason: `${str(d.account) || str(d.toolkit)} · expires ${str(d.expiresAt)}`,
          args: {},
        },
      ];
    }
    case 'approval.decided':
    case 'approval.expired': {
      const id = str(d.intentId);
      const tool = s.approvals.get(id) ?? '';
      return [
        { type: 'approval_decided', approvalId: id, tool, decision: d.decision === 'approved' ? 'approve' : 'reject' },
      ];
    }
    case 'action.confirmed':
    case 'action.failed':
    case 'action.unknown_outcome': {
      const step = s.steps.get(`approval:${str(d.intentId)}`);
      if (!step) return [];
      step.ok = e.type === 'action.confirmed';
      step.preview =
        e.type === 'action.unknown_outcome' ? 'Outcome unknown — check your account' : str(d.reason) || undefined;
      return [{ type: 'step_done', step: { ...step } }];
    }
    case 'question.asked':
      return [
        {
          type: 'question',
          question: {
            questionId: str(d.questionId),
            kind: str(d.kind),
            prompt: str(d.prompt),
            options: Array.isArray(d.options) ? (d.options as Array<{ id: string; label: string }>) : [],
            gate: d.gate === true,
            expiresAt: str(d.expiresAt),
          },
        },
      ];
    case 'question.answered':
    case 'question.expired':
      return [
        {
          type: 'question_resolved',
          questionId: str(d.questionId),
          status: e.type === 'question.answered' ? 'answered' : 'expired',
          answer: (d.answer as { choices: string[]; text?: string } | undefined) ?? null,
        },
      ];
    case 'budget.blocked':
      return [{ type: 'debug', kind: 'budget', data: d }];
    case 'task.completed':
      return [
        ...(ctx.finalMessage ? [{ type: 'message', message: ctx.finalMessage } as RunWireEvent] : []),
        { type: 'done', status: 'done' },
      ];
    case 'task.cancelled':
      return [
        ...(ctx.finalMessage ? [{ type: 'message', message: ctx.finalMessage } as RunWireEvent] : []),
        { type: 'done', status: 'cancelled' },
      ];
    case 'task.failed':
      return [
        ...(ctx.finalMessage ? [{ type: 'message', message: ctx.finalMessage } as RunWireEvent] : []),
        {
          type: 'error',
          code: /limit/i.test(str(d.reason)) ? 'step_limit' : /budget/i.test(str(d.reason)) ? 'budget' : 'failed',
          message: str(d.reason) || 'The run failed.',
        },
      ];
    default:
      // Workspace/browser lifecycle and artifacts: visible in Debug mode only.
      return [{ type: 'debug', kind: e.type, data: d }];
  }
}

export const TERMINAL_EVENTS = new Set(['task.completed', 'task.failed', 'task.cancelled']);
