"use client";

import { useState } from "react";
import { CaretRight, Warning } from "@phosphor-icons/react/dist/ssr";
import { Dot, LiveGlyph } from "@/components/ui";
import type { ChatMessage, MessagePart } from "@/lib/messages";
import type { RunStepView } from "@/lib/run-events";
import { Markdown } from "./markdown";
import { cn } from "@/lib/cn";
import styles from "./transcript.module.css";

/**
 * The chat column. Both roles are left-aligned on one 760px measure with a role
 * gutter — long technical turns read better than in alternating bubbles
 * (DESIGN_SYSTEM §Reference reading, "Reject").
 */
export interface TranscriptProps {
  messages: ChatMessage[];
  /** Text for the turn currently streaming, if any. */
  streamingText: string;
  steps: RunStepView[];
  activity: string | null;
  phase: string;
  error: string | null;
}

export function Transcript({
  messages,
  streamingText,
  steps,
  activity,
  phase,
  error,
}: TranscriptProps) {
  return (
    <div className={styles.root}>
      {messages.map((message) => (
        <Turn key={message.id} message={message} />
      ))}

      {streamingText && (
        <article className={cn(styles.turn, styles.assistant)}>
          <span className={styles.gutter} aria-hidden>
            <LiveGlyph state="thinking" size={16} label="" />
          </span>
          <div className={styles.body}>
            <Markdown content={streamingText} />
          </div>
        </article>
      )}

      {steps.length > 0 && <StepList steps={steps} />}

      {activity && <ActivityLine label={activity} phase={phase} />}

      {error && (
        <p className={styles.error} role="alert">
          <Warning size={15} weight="fill" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

function Turn({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    return <ToolTurn parts={message.content} />;
  }

  const text = message.content
    .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");

  const isUser = message.role === "user";
  if (!text) return null;

  return (
    <article className={cn(styles.turn, isUser ? styles.user : styles.assistant)}>
      <span className={styles.gutter} aria-hidden>
        {isUser ? <span className={styles.youMark}>You</span> : <LiveGlyph state="done" size={16} label="" />}
      </span>
      <div className={styles.body}>
        {isUser ? <p className={styles.userText}>{text}</p> : <Markdown content={text} />}
      </div>
    </article>
  );
}

/** Completed tool observations, rendered as compact chips rather than prose. */
function ToolTurn({ parts }: { parts: MessagePart[] }) {
  const results = parts.filter(
    (p): p is Extract<MessagePart, { type: "tool_result" }> => p.type === "tool_result",
  );
  if (results.length === 0) return null;

  return (
    <div className={styles.chips}>
      {results.map((result) => (
        <Chip
          key={result.toolUseId}
          label={result.name}
          ok={result.ok}
          ms={result.ms ?? null}
          detail={result.text}
        />
      ))}
    </div>
  );
}

function StepList({ steps }: { steps: RunStepView[] }) {
  return (
    <div className={styles.chips}>
      {steps.map((step) => (
        <Chip
          key={step.idx}
          label={step.toolName ?? step.label}
          ok={step.ok}
          ms={step.ms}
          detail={step.preview ?? null}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  ok,
  ms,
  detail,
}: {
  label: string;
  ok: boolean | null;
  ms: number | null;
  detail: string | null;
}) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(detail?.trim());

  return (
    <div className={cn(styles.chip, open && styles.chipOpen)}>
      <button
        type="button"
        className={styles.chipHead}
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
      >
        <Dot status={ok === null ? "pending" : ok ? "ok" : "error"} size="sm" pulse={ok === null} />
        <span className={styles.chipName}>{label}</span>
        {ms !== null && <span className={styles.chipMs}>{ms}ms</span>}
        {expandable && (
          <CaretRight size={11} weight="bold" className={styles.chipCaret} aria-hidden />
        )}
      </button>
      {open && detail && <pre className={styles.chipDetail}>{detail}</pre>}
    </div>
  );
}

/**
 * The understated live summary: one glyph, one verb. This is the primary
 * progress signal; the chips above are the audit trail.
 */
function ActivityLine({ label, phase }: { label: string; phase: string }) {
  const state =
    phase === "approval"
      ? "approval"
      : phase === "tool" || phase === "waiting"
        ? "tool"
        : "thinking";

  return (
    <p className={styles.activity} aria-live="polite">
      <LiveGlyph state={state} size={16} label="" />
      <span className={styles.activityLabel}>{label}</span>
      <span className={styles.activityDots} aria-hidden>
        <i />
        <i />
        <i />
      </span>
    </p>
  );
}
