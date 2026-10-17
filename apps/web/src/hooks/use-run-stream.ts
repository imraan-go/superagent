'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, QuestionPart } from '@/lib/messages';
import type { RunEvent, RunStepView } from '@/lib/run-events';

/**
 * Subscribes to one run's SSE transcript.
 *
 * `EventSource` reconnects on its own and replays `Last-Event-ID`, which the
 * server honours (ADR-05) — so a dropped connection resumes exactly rather than
 * replaying the run from the start or losing the tail.
 */
export type RunPhase = 'idle' | 'thinking' | 'tool' | 'waiting' | 'approval' | 'done' | 'error';

export interface RunState {
  runId: string | null;
  phase: RunPhase;
  /** Assistant text being streamed for the current turn. */
  streamingText: string;
  steps: RunStepView[];
  /** Plain-language line under the transcript. */
  activity: string | null;
  usage: { tokensIn: number; tokensOut: number; cached: number; costUsd: number; thinkingTokens?: number } | null;
  approval: { tool: string; reason: string; args: Record<string, unknown> } | null;
  error: string | null;
  /** Machine code of `error` (e.g. "step_limit"). */
  errorCode: string | null;
  /** Reasoning streamed for the current turn (Thinking mode). */
  streamingThinking: string;
  /** Debug-mode frames, in order (capped). */
  debug: DebugEntry[];
  /** What the server picked for this run's capability chips. */
  capabilities: { auto: boolean; chosen: string[]; reasons: string[] } | null;
  /** The question this run asked most recently (pending until answered or expired). */
  question: QuestionPart | null;
}

export interface DebugEntry {
  seq: number;
  at: number;
  kind: string;
  data: Record<string, unknown>;
}

const DEBUG_CAP = 400;

export const IDLE_RUN: RunState = {
  runId: null,
  phase: 'idle',
  streamingText: '',
  steps: [],
  activity: null,
  usage: null,
  approval: null,
  error: null,
  errorCode: null,
  streamingThinking: '',
  debug: [],
  capabilities: null,
  question: null,
};

export interface UseRunStream {
  state: RunState;
  /** Turns persisted during this run, appended as `message` frames arrive. */
  messages: ChatMessage[];
  start: (runId: string) => void;
  /**
   * Re-attaches to a run this hook already followed, after it paused and was
   * resumed by a decision. Continues from the last seen sequence number, so
   * the transcript, steps and usage carry on rather than starting over.
   */
  resume: (runId: string) => void;
  reset: () => void;
  markAnswered: (questionId: string, answer: { choices: string[]; text?: string }) => void;
}

export function useRunStream(onSettled?: () => void, onEvent?: (event: RunEvent) => void): UseRunStream {
  const [state, setState] = useState<RunState>(IDLE_RUN);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const sourceRef = useRef<EventSource | null>(null);
  const followRef = useRef<{ runId: string | null; seq: number }>({ runId: null, seq: 0 });

  // Kept in refs so `start` does not change identity when the caller passes a
  // fresh closure; written in an effect because refs must not be touched during
  // render (react-hooks/refs).
  const settledRef = useRef(onSettled);
  const eventRef = useRef(onEvent);
  useEffect(() => {
    settledRef.current = onSettled;
    eventRef.current = onEvent;
  }, [onSettled, onEvent]);

  const close = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const reset = useCallback(() => {
    close();
    followRef.current = { runId: null, seq: 0 };
    setState(IDLE_RUN);
    setMessages([]);
  }, [close]);

  const attach = useCallback(
    (runId: string, afterSeq: number) => {
      const qs = afterSeq > 0 ? `?lastEventId=${afterSeq}` : '';
      const source = new EventSource(`/api/runs/${runId}/events${qs}`);
      sourceRef.current = source;

      source.onmessage = (raw: MessageEvent<string>) => {
        let event: RunEvent;
        try {
          event = JSON.parse(raw.data) as RunEvent;
        } catch {
          return;
        }

        const seq = Number.parseInt(raw.lastEventId, 10);
        if (Number.isFinite(seq) && seq > followRef.current.seq) followRef.current.seq = seq;

        if (event.type === 'message') {
          setMessages((prev) => (prev.some((m) => m.id === event.message.id) ? prev : [...prev, event.message]));
        }

        setState((prev) => reduce(prev, event, followRef.current.seq));
        eventRef.current?.(event);

        if (event.type === 'done' || event.type === 'error') {
          close();
          settledRef.current?.();
        }
      };

      source.onerror = () => {
        // EventSource retries on its own; only a closed source is terminal.
        if (source.readyState === EventSource.CLOSED) {
          setState((prev) => ({
            ...prev,
            phase: 'error',
            error: 'Lost the connection to this run.',
          }));
          close();
        }
      };
    },
    [close],
  );

  const start = useCallback(
    (runId: string) => {
      close();
      followRef.current = { runId, seq: 0 };
      setState({ ...IDLE_RUN, runId, phase: 'thinking', activity: 'Thinking' });
      setMessages([]);
      attach(runId, 0);
    },
    [attach, close],
  );

  /** Optimistic: the card settles as soon as the owner answers; the stream confirms it. */
  const markAnswered = useCallback((questionId: string, answer: { choices: string[]; text?: string }) => {
    setState((prev) =>
      prev.question?.questionId === questionId
        ? {
            ...prev,
            phase: 'thinking',
            activity: 'Got it — continuing',
            question: { ...prev.question, status: 'answered', answer },
          }
        : prev,
    );
  }, []);

  const resume = useCallback(
    (runId: string) => {
      if (followRef.current.runId !== runId) return start(runId);
      close();
      setState((prev) => ({ ...prev, phase: 'thinking', activity: 'Thinking', approval: null }));
      attach(runId, followRef.current.seq);
    },
    [attach, close, start],
  );

  useEffect(() => close, [close]);

  return { state, messages, start, resume, reset, markAnswered };
}

function reduce(state: RunState, event: RunEvent, seq = 0): RunState {
  switch (event.type) {
    case 'run_started':
      return { ...state, runId: event.runId, phase: 'thinking', activity: 'Thinking' };

    case 'token':
      return {
        ...state,
        phase: 'thinking',
        activity: 'Thinking',
        streamingText: state.streamingText + event.text,
      };

    case 'thinking':
      return {
        ...state,
        phase: 'thinking',
        activity: 'Reasoning',
        streamingThinking: state.streamingThinking + event.text,
      };

    case 'debug':
      return {
        ...state,
        debug: [...state.debug, { seq, at: Date.now(), kind: event.kind, data: event.data }].slice(-DEBUG_CAP),
      };

    case 'capabilities':
      return { ...state, capabilities: { auto: event.auto, chosen: event.chosen, reasons: event.reasons } };

    case 'step':
      return {
        ...state,
        phase: 'tool',
        activity: event.step.label,
        steps: [...state.steps, event.step],
      };

    case 'step_done':
      return {
        ...state,
        steps: state.steps.map((s) => (s.idx === event.step.idx ? event.step : s)),
      };

    case 'waiting':
      return { ...state, phase: 'waiting', activity: event.reason };

    case 'approval_decided':
      return {
        ...state,
        phase: 'thinking',
        activity: event.decision === 'approve' ? 'Approved — continuing' : 'Rejected — wrapping up',
        approval: null,
      };

    case 'approval_required':
      return {
        ...state,
        phase: 'approval',
        activity: 'Waiting for your approval',
        approval: { tool: event.tool, reason: event.reason, args: event.args },
      };

    case 'question':
      return {
        ...state,
        phase: 'approval',
        activity: event.question.gate ? 'Waiting for your confirmation' : 'Waiting for your answer',
        question: { type: 'question', status: 'pending', answer: null, ...event.question },
      };

    case 'question_resolved':
      return {
        ...state,
        phase: 'thinking',
        activity: event.status === 'answered' ? 'Got it — continuing' : 'No answer — continuing',
        question:
          state.question?.questionId === event.questionId
            ? { ...state.question, status: event.status, answer: event.answer }
            : state.question,
      };

    case 'usage':
      return {
        ...state,
        usage: {
          tokensIn: event.tokensIn,
          tokensOut: event.tokensOut,
          cached: event.cached,
          costUsd: event.costUsd,
          ...(event.thinkingTokens ? { thinkingTokens: event.thinkingTokens } : {}),
        },
      };

    case 'message':
      // The persisted turn supersedes the streamed text for that turn.
      return { ...state, streamingText: '', streamingThinking: '' };

    case 'done':
      return {
        ...state,
        phase: event.status === 'paused_approval' ? 'approval' : 'done',
        activity: null,
        streamingText: '',
        streamingThinking: '',
      };

    case 'error':
      return { ...state, phase: 'error', activity: null, error: event.message, errorCode: event.code };
  }
}
