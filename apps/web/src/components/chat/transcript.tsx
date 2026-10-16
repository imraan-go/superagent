"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  Check,
  Copy,
  FastForward,
  FileText,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { LiveGlyph, SkeletonText } from "@/components/ui";
import { api } from "@/lib/api";
import type { ChatMessage, MessagePart } from "@/lib/messages";
import type { RunStepView } from "@/lib/run-events";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/uploads";
import { groupExchanges, liveTrace } from "./parts/exchanges";
import type { Exchange } from "./parts/exchanges";
import { RunTrace } from "./parts/run-trace";
import { ReasoningBlock } from "./parts/reasoning-block";
import { DebugPanel } from "./parts/debug-panel";
import { QuestionCard } from "./parts/question-card";
import type { QuestionAnswer } from "./parts/question-card";
import type { QuestionPart } from "@/lib/messages";
import type { DebugEntry } from "@/hooks/use-run-stream";
import { DEFAULT_CHAT_MODE, traceStaysOpen } from "@/lib/chat-mode";
import type { ChatMode } from "@/lib/chat-mode";
import modeStyles from "./parts/modes.module.css";
import { formatMs } from "./parts/tool-meta";
import styles from "./transcript.module.css";

/**
 * react-markdown + remark-gfm are the heaviest thing on the chat route, so they
 * load as their own chunk. Until then a text-shaped skeleton holds the space.
 */
const Markdown = dynamic(() => import("./markdown").then((m) => m.Markdown), {
  loading: () => <SkeletonText lines={3} />,
});

export interface RunUsage {
  tokensIn: number;
  tokensOut: number;
  cached: number;
  costUsd: number;
  /** Estimated reasoning tokens (included in tokensOut). */
  thinkingTokens?: number;
}

/**
 * The chat column, as exchanges: the owner's turn, then one agent turn holding
 * the run trace and the answer. Both roles sit left-aligned on one 760px
 * measure (DESIGN_SYSTEM §Reference reading, "Reject" alternating bubbles).
 */
export interface TranscriptProps {
  messages: ChatMessage[];
  /** Text for the turn currently streaming, if any. */
  streamingText: string;
  steps: RunStepView[];
  activity: string | null;
  phase: string;
  error: string | null;
  runId?: string | null;
  usage?: RunUsage | null;
  approval?: { tool: string; reason: string } | null;
  /** Re-send an earlier owner turn. */
  onRetry?: (text: string) => void;
  onContinue?: () => void;
  /** Conversation mode of this chat (trace/readout behaviour). */
  mode?: ChatMode;
  /** Reasoning streaming for the current turn (Thinking mode). */
  streamingThinking?: string;
  /** Debug-mode frames of the current run. */
  debug?: DebugEntry[];
  /** Machine code of `error` ("step_limit" shows a Continue button). */
  errorCode?: string | null;
  /** The live run's latest question (pending until answered). */
  question?: QuestionPart | null;
  onAnswer?: (q: QuestionPart, answer: QuestionAnswer) => void;
  answering?: boolean;
}

const LIVE_PHASES = new Set(["thinking", "tool", "waiting", "approval"]);

export function Transcript({
  messages,
  streamingText,
  steps,
  activity,
  phase,
  error,
  runId = null,
  usage = null,
  approval = null,
  onRetry,
  onContinue,
  mode = DEFAULT_CHAT_MODE,
  streamingThinking = "",
  debug = [],
  errorCode = null,
  question = null,
  onAnswer,
  answering = false,
}: TranscriptProps) {
  const exchanges = useMemo(() => groupExchanges(messages), [messages]);
  const running = LIVE_PHASES.has(phase);
  const lastIdx = exchanges.length - 1;

  return (
    <div className={styles.root}>
      {exchanges.map((ex, i) => {
        // The run in flight belongs to the newest exchange once its owner turn
        // has landed (its agent turns may not have yet).
        const isCurrent = runId !== null && i === lastIdx && (ex.runId === runId || ex.runId === null);
        return (
          <ExchangeView
            key={ex.key}
            exchange={ex}
            live={isCurrent && running}
            current={isCurrent}
            streamingText={isCurrent ? streamingText : ""}
            steps={isCurrent ? steps : []}
            activity={activity}
            phase={phase}
            usage={isCurrent ? usage : null}
            approval={isCurrent ? approval : null}
            error={isCurrent ? error : null}
            isLast={i === lastIdx}
            onRetry={onRetry}
            onContinue={onContinue}
            mode={mode}
            streamingThinking={isCurrent ? streamingThinking : ""}
            debug={isCurrent ? debug : []}
            errorCode={isCurrent ? errorCode : null}
            question={isCurrent ? question : null}
            onAnswer={onAnswer}
            answering={answering}
          />
        );
      })}

      {/* A run whose owner turn is not in the list yet (just sent). */}
      {exchanges.length === 0 && running && (
        <AgentShell>
          <RunTrace items={[]} live activity={activity} phase={phase} approval={approval} />
        </AgentShell>
      )}

      {error && exchanges.length === 0 && <ErrorLine message={error} />}
    </div>
  );
}

function AgentShell({ children, glyph = "done" }: { children: React.ReactNode; glyph?: "done" | "thinking" | "error" }) {
  return (
    <article className={cn(styles.turn, styles.assistant)}>
      <span className={styles.gutter} aria-hidden>
        <LiveGlyph state={glyph} size={16} label="" />
      </span>
      <div className={styles.body}>{children}</div>
    </article>
  );
}

function ExchangeView({
  exchange: ex,
  live,
  current,
  streamingText,
  steps,
  activity,
  phase,
  usage,
  approval,
  error,
  isLast,
  onRetry,
  onContinue,
  mode,
  streamingThinking,
  debug,
  errorCode,
  question,
  onAnswer,
  answering,
}: {
  question: QuestionPart | null;
  onAnswer?: (q: QuestionPart, answer: QuestionAnswer) => void;
  answering: boolean;
  mode: ChatMode;
  streamingThinking: string;
  debug: DebugEntry[];
  errorCode: string | null;
  exchange: Exchange;
  live: boolean;
  current: boolean;
  streamingText: string;
  steps: RunStepView[];
  activity: string | null;
  phase: string;
  usage: RunUsage | null;
  approval: { tool: string; reason: string } | null;
  error: string | null;
  isLast: boolean;
  onRetry?: (text: string) => void;
  onContinue?: () => void;
}) {
  // While the run is in flight the stream carries timing, status and images
  // before the turn rows land; afterwards the persisted rows are complete.
  const trace = live && steps.length > 0 ? liveTrace(steps, ex.trace) : ex.trace;
  const answer = streamingText || ex.answer;
  const streaming = Boolean(streamingText) && live;
  const userText = ex.user ? textOf(ex.user.content) : "";
  const reasoning = [ex.reasoning, streamingThinking].filter(Boolean).join("\n\n");
  // Persisted questions, with the live one overlaid (it lands in the stored turn only at the end).
  const questions = question && !ex.questions.some((q) => q.questionId === question.questionId) ? [...ex.questions, question] : ex.questions.map((q) => (question?.questionId === q.questionId ? question : q));
  const hasAgent = live || trace.length > 0 || Boolean(answer) || Boolean(error) || Boolean(reasoning) || questions.length > 0;
  const expanded = traceStaysOpen(mode);

  if (ex.note) {
    return (
      <p className={styles.note} role="note">
        {ex.note}
      </p>
    );
  }

  return (
    <>
      {ex.user && <UserTurn message={ex.user} />}
      {hasAgent && (
        <AgentShell glyph={live ? "thinking" : error ? "error" : "done"}>
          {reasoning && <ReasoningBlock text={reasoning} live={live && Boolean(streamingThinking)} />}
          {(live || trace.length > 0) && (
            <div className={styles.traceSlot}>
              <RunTrace
                key={live ? "live" : "settled"}
                items={trace}
                live={live}
                activity={activity}
                phase={phase}
                approval={approval}
                keepOpen={expanded}
                expandSteps={expanded}
              />
            </div>
          )}
          {questions.map((q) => (
            <QuestionCard
              key={q.questionId}
              question={q}
              busy={answering}
              onAnswer={onAnswer && q.status === "pending" ? (a) => onAnswer(q, a) : undefined}
            />
          ))}
          {answer && (
            <div className={cn(styles.answer, streaming && styles.streaming)}>
              <Markdown content={answer} />
            </div>
          )}
          {error && (
            <ErrorLine
              message={error}
              onContinue={errorCode === "step_limit" && isLast ? onContinue : undefined}
            />
          )}
          {mode === "debug" && debug.length > 0 && <DebugPanel entries={debug} />}
          {!live && (answer || error) && (
            <Footer
              exchange={ex}
              usage={current ? usage : null}
              answer={answer}
              onRetry={userText && onRetry ? () => onRetry(userText) : undefined}
              onContinue={isLast ? onContinue : undefined}
            />
          )}
        </AgentShell>
      )}
    </>
  );
}

function ErrorLine({ message, onContinue }: { message: string; onContinue?: () => void }) {
  return (
    <p className={styles.error} role="alert">
      <Warning size={15} weight="fill" aria-hidden />
      {message}
      {onContinue && (
        <button type="button" className={modeStyles.continue} onClick={onContinue}>
          <FastForward size={12} aria-hidden /> Continue
        </button>
      )}
    </p>
  );
}

function textOf(parts: MessagePart[]): string {
  return parts
    .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");
}

function UserTurn({ message }: { message: ChatMessage }) {
  const text = textOf(message.content);
  const attachments = message.content.filter(
    (p): p is Extract<MessagePart, { type: "image" | "file" }> => p.type === "image" || p.type === "file",
  );
  if (!text && attachments.length === 0) return null;

  return (
    <article className={cn(styles.turn, styles.user)}>
      <span className={styles.gutter} aria-hidden>
        <span className={styles.youMark}>You</span>
      </span>
      <div className={styles.body}>
        {attachments.length > 0 && <Attachments parts={attachments} />}
        {text && <p className={styles.userText}>{text}</p>}
      </div>
    </article>
  );
}

/**
 * Mono readout row. Tokens and cost come only from the run's `usage` frame —
 * per-message usage is not persisted client-side, so settled history shows
 * model and latency alone rather than invented numbers.
 */
function Footer({
  exchange: ex,
  usage,
  answer,
  onRetry,
  onContinue,
}: {
  exchange: Exchange;
  usage: RunUsage | null;
  answer: string;
  onRetry?: () => void;
  onContinue?: () => void;
}) {
  const { data } = useQuery({ queryKey: ["models"], queryFn: api.listModels, staleTime: 60_000 });
  const modelLabel = ex.model ? (data?.models.find((m) => m.id === ex.model)?.label ?? ex.model) : null;
  const from = ex.user?.createdAt ?? ex.startedAt;
  const latency =
    from && ex.endedAt ? new Date(ex.endedAt).getTime() - new Date(from).getTime() : null;

  return (
    <footer className={styles.footer}>
      <span className={styles.readouts}>
        {modelLabel && <span>{modelLabel}</span>}
        {usage && (
          <span title={`${usage.cached.toLocaleString()} cached`}>
            {compact(usage.tokensIn)} in · {compact(usage.tokensOut)} out
            {usage.thinkingTokens ? ` (≈${compact(usage.thinkingTokens)} reasoning)` : ""}
          </span>
        )}
        {usage && <span>${usage.costUsd < 0.01 ? usage.costUsd.toFixed(4) : usage.costUsd.toFixed(2)}</span>}
        {latency !== null && latency > 0 && <span>{formatMs(latency)}</span>}
      </span>
      <span className={styles.actions}>
        {answer && <CopyAction text={answer} />}
        {onRetry && (
          <button type="button" className={styles.action} onClick={onRetry} title="Send the same prompt again">
            <ArrowClockwise size={13} aria-hidden /> Retry
          </button>
        )}
        {onContinue && (
          <button type="button" className={styles.action} onClick={onContinue} title="Ask the agent to keep going">
            <FastForward size={13} aria-hidden /> Continue
          </button>
        )}
      </span>
    </footer>
  );
}

function compact(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className={styles.action}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
    >
      {copied ? <Check size={13} weight="bold" aria-hidden /> : <Copy size={13} aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </button>
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
