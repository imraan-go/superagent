"use client";

import { Fragment, useState } from "react";
import { CaretRight, FileText, Warning } from "@phosphor-icons/react/dist/ssr";
import dynamic from "next/dynamic";
import { Dot, LiveGlyph, SkeletonText } from "@/components/ui";
import type { ChatMessage, MessagePart } from "@/lib/messages";
import type { RunStepView } from "@/lib/run-events";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/uploads";
import styles from "./transcript.module.css";

/**
 * react-markdown + remark-gfm are the heaviest thing on the chat route, so they
 * load as their own chunk. Until then a text-shaped skeleton holds the space.
 */
const Markdown = dynamic(() => import("./markdown").then((m) => m.Markdown), {
  loading: () => <SkeletonText lines={3} />,
});

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
  const attachments = message.content.filter(
    (p): p is Extract<MessagePart, { type: "image" | "file" }> =>
      p.type === "image" || p.type === "file",
  );
  if (!text && attachments.length === 0) return null;

  return (
    <article className={cn(styles.turn, isUser ? styles.user : styles.assistant)}>
      <span className={styles.gutter} aria-hidden>
        {isUser ? <span className={styles.youMark}>You</span> : <LiveGlyph state="done" size={16} label="" />}
      </span>
      <div className={styles.body}>
        {attachments.length > 0 && <Attachments parts={attachments} />}
        {text && (isUser ? <p className={styles.userText}>{text}</p> : <Markdown content={text} />)}
      </div>
    </article>
  );
}

/** Files the owner attached to a turn: image thumbnails and file chips. */
function Attachments({ parts }: { parts: Array<Extract<MessagePart, { type: "image" | "file" }>> }) {
  return (
    <ul className={styles.attachments} aria-label="Attachments">
      {parts.map((part) =>
        part.type === "image" ? (
          <li key={part.fileId}>
            <a href={`/api/uploads/${part.fileId}`} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={styles.attachThumb}
                src={`/api/uploads/${part.fileId}`}
                alt={part.alt ?? "Attached image"}
                loading="lazy"
              />
            </a>
          </li>
        ) : (
          <li key={part.fileId}>
            <a className={styles.attachFile} href={`/api/uploads/${part.fileId}`} download={part.name}>
              <FileText size={14} aria-hidden /> {part.name}
              <span className={styles.attachMeta}>{formatBytes(part.bytes)}</span>
            </a>
          </li>
        ),
      )}
    </ul>
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
        <Fragment key={result.toolUseId}>
          <Chip label={result.name} ok={result.ok} ms={result.ms ?? null} detail={result.text} />
          {result.images.map((id) => (
            <a key={id} href={`/api/uploads/${id}`} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.shot} src={`/api/uploads/${id}`} alt={`${result.name} screenshot`} loading="lazy" />
            </a>
          ))}
        </Fragment>
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
