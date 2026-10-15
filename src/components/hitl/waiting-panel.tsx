"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChatCircleDots,
  CheckCircle,
  HandPointing,
  Monitor,
  ShieldWarning,
} from "@phosphor-icons/react/dist/ssr";
import { Button, Dot, HoldToConfirm, Panel, useToast } from "@/components/ui";
import { PENDING_KEY, usePending } from "@/hooks/use-pending";
import { useDesktopNotify } from "@/hooks/use-desktop-notify";
import { OPEN_COMPUTER_EVENT, RUN_RESUMED_EVENT } from "@/lib/hitl";
import type { PendingItem, RunResumedDetail } from "@/lib/hitl";
import { formatAge } from "@/lib/hitl";
import { isTypingTarget } from "@/lib/hotkeys";
import styles from "./hitl.module.css";

/**
 * "Waiting on you": every pending approval, question and takeover request, with
 * the control that answers it inline (skill-approvals-hitl).
 */
export function WaitingPanel() {
  const { data } = usePending();
  const notifications = useDesktopNotify();
  const items = data?.items ?? [];

  return (
    <Panel
      title="Waiting on you"
      badge={<Dot status={items.length > 0 ? "warn" : "idle"} size="sm" pulse={items.length > 0} />}
      actions={
        notifications.permission === "default" ? (
          <Button size="sm" variant="ghost" onClick={() => void notifications.enable()}>
            Enable alerts
          </Button>
        ) : undefined
      }
    >
      {data && !data.reachable && (
        <p className={styles.muted}>Cannot reach the agent computer&apos;s request queue.</p>
      )}
      {items.length === 0 ? (
        <p className={styles.muted}>Nothing needs you right now.</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <WaitingItem key={`${item.source}:${item.id}`} item={item} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

const KIND_META = {
  confirm: { icon: ShieldWarning, label: "Approval" },
  ask: { icon: ChatCircleDots, label: "Question" },
  takeover: { icon: HandPointing, label: "Takeover" },
} as const;

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined;
    throw new Error(err?.message ?? `Request failed (${res.status}).`);
  }
  return json;
}

function WaitingItem({ item }: { item: PendingItem }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [answer, setAnswer] = useState("");
  const { icon: Icon, label } = KIND_META[item.kind];
  const promptId = `hitl-${item.id}`;

  const settle = () => void queryClient.invalidateQueries({ queryKey: PENDING_KEY });

  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      post(`/api/approvals/${item.id}`, { decision }),
    onSuccess: (res, decision) => {
      settle();
      if (typeof res.runId === "string" && typeof res.chatId === "string") {
        window.dispatchEvent(
          new CustomEvent<RunResumedDetail>(RUN_RESUMED_EVENT, {
            detail: { runId: res.runId, chatId: res.chatId },
          }),
        );
      }
      toast.push({
        title: decision === "approve" ? "Approved" : "Rejected",
        tone: decision === "approve" ? "success" : "info",
      });
    },
    onError: (err: Error) => {
      settle();
      toast.push({ title: "Could not record the decision", message: err.message, tone: "error" });
    },
  });

  const reply = useMutation({
    mutationFn: (text: string) => post(`/api/hitl/${item.id}/answer`, { text }),
    onSuccess: () => {
      setAnswer("");
      settle();
      toast.push({ title: "Answer sent", tone: "success" });
    },
    onError: (err: Error) =>
      toast.push({ title: "Could not send the answer", message: err.message, tone: "error" }),
  });

  const done = useMutation({
    mutationFn: () => post(`/api/hitl/${item.id}/done`, {}),
    onSuccess: () => {
      settle();
      toast.push({ title: "Handed back to the agent", tone: "success" });
    },
    onError: (err: Error) =>
      toast.push({ title: "Could not hand back control", message: err.message, tone: "error" }),
  });

  const busy = decide.isPending || reply.isPending || done.isPending;
  const cardRef = useRef<HTMLLIElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  // Card keys, only while the card itself (or a button in it) has focus.
  // Approve is deliberately NOT here: `A` is a press-and-hold wired through
  // HoldToConfirm, so a single tap can never approve.
  const onCardKeyDown = (e: React.KeyboardEvent<HTMLLIElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || busy) return;
    if (isTypingTarget(e.target as Element)) return;
    if (e.key.toLowerCase() === "r" && item.kind === "confirm") {
      e.preventDefault();
      decide.mutate("reject");
    } else if (e.key === "Enter" && item.kind === "ask" && e.target === e.currentTarget) {
      e.preventDefault();
      if (answer.trim()) reply.mutate(answer.trim());
      else answerRef.current?.focus();
    }
  };

  const shortcut =
    item.kind === "confirm"
      ? "Hold A to approve, R to reject"
      : item.kind === "ask"
        ? "Enter to answer"
        : undefined;

  return (
    <li
      ref={cardRef}
      className={styles.item}
      data-kind={item.kind}
      data-waiting-card=""
      tabIndex={0}
      aria-busy={busy}
      aria-label={`${label}: ${item.prompt || "no details given"}${shortcut ? `. ${shortcut}` : ""}`}
      aria-keyshortcuts={item.kind === "confirm" ? "R" : undefined}
      onKeyDown={onCardKeyDown}
    >
      <div className={styles.itemHead}>
        <span className={styles.kindIcon} aria-hidden>
          <Icon size={16} weight="duotone" />
        </span>
        <span className={styles.kind}>{label}</span>
        <time className={styles.age} dateTime={item.createdAt} title={item.createdAt}>
          {formatAge(item.createdAt)}
        </time>
      </div>
      <p className={styles.prompt} id={promptId}>
        {item.prompt || "(no details given)"}
      </p>

      {item.kind === "confirm" && (
        <div className={styles.actions} role="group" aria-labelledby={promptId}>
          <HoldToConfirm
            size="sm"
            tone="attention"
            disabled={busy}
            icon={<CheckCircle size={14} weight="bold" />}
            label={`Approve: ${item.prompt}`}
            holdKey="a"
            keyScope={cardRef}
            onConfirm={() => decide.mutate("approve")}
          >
            Approve
          </HoldToConfirm>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => decide.mutate("reject")}>
            Reject
          </Button>
        </div>
      )}

      {item.kind === "ask" && (
        <form
          className={styles.answer}
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) reply.mutate(answer.trim());
          }}
        >
          <label className={styles.srOnly} htmlFor={`${promptId}-answer`}>
            Your answer
          </label>
          <textarea
            id={`${promptId}-answer`}
            ref={answerRef}
            className={styles.input}
            rows={2}
            maxLength={4000}
            value={answer}
            placeholder="Type your answer…"
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button size="sm" variant="primary" type="submit" disabled={busy || !answer.trim()}>
            Send
          </Button>
        </form>
      )}

      {item.kind === "takeover" && (
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_COMPUTER_EVENT))}
          >
            <Monitor size={14} weight="bold" aria-hidden /> Open computer
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => done.mutate()}>
            Done
          </Button>
        </div>
      )}
    </li>
  );
}
