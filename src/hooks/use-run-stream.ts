"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/messages";
import type { RunEvent, RunStepView } from "@/lib/run-events";

/**
 * Subscribes to one run's SSE transcript.
 *
 * `EventSource` reconnects on its own and replays `Last-Event-ID`, which the
 * server honours (ADR-05) — so a dropped connection resumes exactly rather than
 * replaying the run from the start or losing the tail.
 */
export type RunPhase =
  | "idle"
  | "thinking"
  | "tool"
  | "waiting"
  | "approval"
  | "done"
  | "error";

export interface RunState {
  runId: string | null;
  phase: RunPhase;
  /** Assistant text being streamed for the current turn. */
  streamingText: string;
  steps: RunStepView[];
  /** Plain-language line under the transcript. */
  activity: string | null;
  usage: { tokensIn: number; tokensOut: number; cached: number; costUsd: number } | null;
  approval: { tool: string; reason: string; args: Record<string, unknown> } | null;
  error: string | null;
}

export const IDLE_RUN: RunState = {
  runId: null,
  phase: "idle",
  streamingText: "",
  steps: [],
  activity: null,
  usage: null,
  approval: null,
  error: null,
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
}

export function useRunStream(
  onSettled?: () => void,
  onEvent?: (event: RunEvent) => void,
): UseRunStream {
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
      const qs = afterSeq > 0 ? `?lastEventId=${afterSeq}` : "";
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

        if (event.type === "message") {
          setMessages((prev) =>
            prev.some((m) => m.id === event.message.id) ? prev : [...prev, event.message],
          );
        }

        setState((prev) => reduce(prev, event));
        eventRef.current?.(event);

        if (event.type === "done" || event.type === "error") {
          close();
          settledRef.current?.();
        }
      };

      source.onerror = () => {
        // EventSource retries on its own; only a closed source is terminal.
        if (source.readyState === EventSource.CLOSED) {
          setState((prev) => ({
            ...prev,
            phase: "error",
            error: "Lost the connection to this run.",
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
      setState({ ...IDLE_RUN, runId, phase: "thinking", activity: "Thinking" });
      setMessages([]);
      attach(runId, 0);
    },
    [attach, close],
  );

  const resume = useCallback(
    (runId: string) => {
      if (followRef.current.runId !== runId) return start(runId);
      close();
      setState((prev) => ({ ...prev, phase: "thinking", activity: "Thinking", approval: null }));
      attach(runId, followRef.current.seq);
    },
    [attach, close, start],
  );

  useEffect(() => close, [close]);

  return { state, messages, start, resume, reset };
}

function reduce(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case "run_started":
      return { ...state, runId: event.runId, phase: "thinking", activity: "Thinking" };

    case "token":
      return {
        ...state,
        phase: "thinking",
        activity: "Thinking",
        streamingText: state.streamingText + event.text,
      };

    case "step":
      return {
        ...state,
        phase: "tool",
        activity: event.step.label,
        steps: [...state.steps, event.step],
      };

    case "step_done":
      return {
        ...state,
        steps: state.steps.map((s) => (s.idx === event.step.idx ? event.step : s)),
      };

    case "waiting":
      return { ...state, phase: "waiting", activity: event.reason };

    case "approval_decided":
      return {
        ...state,
        phase: "thinking",
        activity: event.decision === "approve" ? "Approved — continuing" : "Rejected — wrapping up",
        approval: null,
      };

    case "approval_required":
      return {
        ...state,
        phase: "approval",
        activity: "Waiting for your approval",
        approval: { tool: event.tool, reason: event.reason, args: event.args },
      };

    case "usage":
      return {
        ...state,
        usage: {
          tokensIn: event.tokensIn,
          tokensOut: event.tokensOut,
          cached: event.cached,
          costUsd: event.costUsd,
        },
      };

    case "message":
      // The persisted turn supersedes the streamed text for that turn.
      return { ...state, streamingText: "" };

    case "done":
      return {
        ...state,
        phase: event.status === "paused_approval" ? "approval" : "done",
        activity: null,
        streamingText: "",
      };

    case "error":
      return { ...state, phase: "error", activity: null, error: event.message };
  }
}
