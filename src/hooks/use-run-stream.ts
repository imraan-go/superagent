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
  reset: () => void;
}

export function useRunStream(onSettled?: () => void): UseRunStream {
  const [state, setState] = useState<RunState>(IDLE_RUN);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const sourceRef = useRef<EventSource | null>(null);

  // Kept in a ref so `start` does not change identity when the caller passes a
  // fresh closure; written in an effect because refs must not be touched during
  // render (react-hooks/refs).
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);

  const close = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const reset = useCallback(() => {
    close();
    setState(IDLE_RUN);
    setMessages([]);
  }, [close]);

  const start = useCallback(
    (runId: string) => {
      close();
      setState({ ...IDLE_RUN, runId, phase: "thinking", activity: "Thinking" });
      setMessages([]);

      const source = new EventSource(`/api/runs/${runId}/events`);
      sourceRef.current = source;

      source.onmessage = (raw: MessageEvent<string>) => {
        let event: RunEvent;
        try {
          event = JSON.parse(raw.data) as RunEvent;
        } catch {
          return;
        }

        if (event.type === "message") {
          setMessages((prev) => [...prev, event.message]);
        }

        setState((prev) => reduce(prev, event));

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

  useEffect(() => close, [close]);

  return { state, messages, start, reset };
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
