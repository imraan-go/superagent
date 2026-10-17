'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChatCircleDots, CaretRight, CheckCircle, ShieldWarning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Button, Dot, HoldToConfirm, Panel, useToast } from '@/components/ui';
import { QuestionCard } from '@/components/chat/parts/question-card';
import type { QuestionAnswer } from '@/components/chat/parts/question-card';
import { readApiError } from '@/lib/api-error';
import { PENDING_KEY, usePending } from '@/hooks/use-pending';
import { useDesktopNotify } from '@/hooks/use-desktop-notify';
import { RUN_RESUMED_EVENT } from '@/lib/hitl';
import type { PendingItem, RunResumedDetail } from '@/lib/hitl';
import { formatAge } from '@/lib/hitl';
import { isTypingTarget } from '@/lib/hotkeys';
import { groupStale } from '@/components/mission/rail-log';
import styles from './hitl.module.css';

/** Dispatched by the chat column: scroll to and focus the first waiting card. */
export const FOCUS_WAITING_EVENT = 'fd:focus-waiting';

/**
 * "Waiting on you": every pending approval, question and takeover request, with
 * the control that answers it inline (skill-approvals-hitl).
 */
const noopSubscribe = () => () => undefined;

export function WaitingPanel() {
  // The pending list comes from the client cache; render it only after mount so the server and
  // first client render agree (no hydration mismatch on the count).
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const { data: live } = usePending();
  const data = mounted ? live : undefined;
  const notifications = useDesktopNotify();
  const items = data?.items ?? [];
  const { fresh, stale } = groupStale(items);
  const rootRef = useRef<HTMLDivElement>(null);
  const [staleOpen, setStaleOpen] = useState(false);

  useEffect(() => {
    const onFocus = () => {
      const root = rootRef.current;
      if (!root) return;
      let card = root.querySelector<HTMLElement>('[data-waiting-card]');
      if (!card && stale.length > 0) {
        setStaleOpen(true);
        // The stale group renders on the next frame.
        requestAnimationFrame(() => {
          const late = rootRef.current?.querySelector<HTMLElement>('[data-waiting-card]');
          late?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          late?.focus({ preventScroll: true });
        });
        return;
      }
      card ??= root;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      card.scrollIntoView({
        block: 'nearest',
        behavior: reduce ? 'auto' : 'smooth',
      });
      card.focus({ preventScroll: true });
    };
    window.addEventListener(FOCUS_WAITING_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_WAITING_EVENT, onFocus);
  }, [stale.length]);

  return (
    <div ref={rootRef} tabIndex={-1} className={styles.root}>
      <Panel
        title={fresh.length > 0 ? `Waiting on you · ${fresh.length}` : 'Waiting on you'}
        badge={<Dot status={fresh.length > 0 ? 'warn' : 'idle'} size="sm" pulse={fresh.length > 0} />}
        actions={
          notifications.permission === 'default' ? (
            <Button size="sm" variant="ghost" onClick={() => void notifications.enable()}>
              Enable alerts
            </Button>
          ) : undefined
        }
      >
        {fresh.length === 0 ? (
          <p className={styles.muted}>Nothing needs you right now.</p>
        ) : (
          <ul className={styles.list}>
            {fresh.map((item) => (
              <WaitingItem key={`${item.source}:${item.id}`} item={item} />
            ))}
          </ul>
        )}
        {stale.length > 0 && (
          <div className={styles.stale}>
            <button
              type="button"
              className={styles.staleToggle}
              aria-expanded={staleOpen}
              onClick={() => setStaleOpen((v) => !v)}
            >
              <CaretRight size={12} weight="bold" className={styles.caret} aria-hidden />
              Stale ({stale.length})<span className={styles.staleHint}>older than 24 h</span>
            </button>
            {staleOpen && (
              <ul className={styles.list}>
                {stale.map((item) => (
                  <WaitingItem key={`${item.source}:${item.id}`} item={item} stale />
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

const KIND_META = {
  confirm: { icon: ShieldWarning, label: 'Approval' },
  ask: { icon: ChatCircleDots, label: 'Question' },
} as const;

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(readApiError(json, res.status).message);
  return json;
}

/** One waiting item with its controls; also rendered inline in the chat for the run it belongs to. */
export function WaitingItem({
  item,
  stale = false,
  inChat = false,
}: {
  item: PendingItem;
  stale?: boolean;
  inChat?: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [answer, setAnswer] = useState('');
  // The exact action is what is being approved, so it is visible unless the owner hides it.
  const [showAll, setShowAll] = useState(item.kind === 'confirm');
  const { icon: Icon, label } = KIND_META[item.kind];
  const promptId = `hitl-${item.id}`;

  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: PENDING_KEY });
    if (item.chatId) void queryClient.invalidateQueries({ queryKey: ['chat', item.chatId] });
  };
  const resumed = () => {
    if (item.runId && item.chatId) {
      window.dispatchEvent(
        new CustomEvent<RunResumedDetail>(RUN_RESUMED_EVENT, { detail: { runId: item.runId, chatId: item.chatId } }),
      );
    }
  };

  // Exact-action approval: the hash and nonce shown here must match what the server stored.
  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      post(`/api/approvals/${item.id}`, { decision, argsHash: item.approval?.argsHash, nonce: item.approval?.nonce }),
    onSuccess: (_res, decision) => {
      settle();
      resumed();
      toast.push({
        title: decision === 'approved' ? 'Approved' : 'Rejected',
        tone: decision === 'approved' ? 'success' : 'info',
      });
    },
    onError: (err: Error) => {
      settle();
      toast.push({ title: 'Could not record the decision', message: err.message, tone: 'error' });
    },
  });

  const reply = useMutation({
    mutationFn: (a: QuestionAnswer) => post(`/api/chats/${item.chatId}/answer`, { questionId: item.id, ...a }),
    onSuccess: () => {
      setAnswer('');
      settle();
      resumed();
      toast.push({ title: 'Answer sent', tone: 'success' });
    },
    onError: (err: Error) => toast.push({ title: 'Could not send the answer', message: err.message, tone: 'error' }),
  });

  const busy = decide.isPending || reply.isPending;
  const cardRef = useRef<HTMLLIElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  // Card keys, only while the card itself (or a button in it) has focus.
  // Approve is deliberately NOT here: `A` is a press-and-hold wired through
  // HoldToConfirm, so a single tap can never approve.
  const onCardKeyDown = (e: React.KeyboardEvent<HTMLLIElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || busy) return;
    if (isTypingTarget(e.target as Element)) return;
    if (e.key.toLowerCase() === 'r' && item.kind === 'confirm') {
      e.preventDefault();
      decide.mutate('rejected');
    } else if (e.key === 'Enter' && item.kind === 'ask' && e.target === e.currentTarget) {
      e.preventDefault();
      answerRef.current?.focus();
    }
  };

  const shortcut = item.kind === 'confirm' ? 'Hold A to approve, R to reject' : 'Enter to answer';
  const q = item.question;

  return (
    <li
      ref={cardRef}
      className={styles.item}
      data-kind={item.kind}
      data-stale={stale || undefined}
      data-waiting-card=""
      tabIndex={0}
      aria-busy={busy}
      aria-label={`${label}: ${item.prompt || 'no details given'}. ${shortcut}`}
      aria-keyshortcuts={item.kind === 'confirm' ? 'R' : undefined}
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

      {item.kind === 'confirm' && (
        <>
          <p className={styles.prompt} id={promptId} data-full={showAll || undefined}>
            {item.prompt}
          </p>
          {item.approval && (
            <>
              <button
                type="button"
                className={styles.more}
                aria-expanded={showAll}
                aria-controls={promptId}
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? 'hide exact action' : 'show exact action'}
              </button>
              {showAll && <pre className={styles.args}>{JSON.stringify(item.approval.args, null, 2)}</pre>}
            </>
          )}
          <div className={styles.actions} role="group" aria-labelledby={promptId}>
            <HoldToConfirm
              size="sm"
              tone="attention"
              disabled={busy}
              icon={<CheckCircle size={14} weight="bold" />}
              label={`Approve: ${item.prompt}`}
              holdKey="a"
              keyScope={cardRef}
              onConfirm={() => decide.mutate('approved')}
            >
              Approve
            </HoldToConfirm>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => decide.mutate('rejected')}>
              Reject
            </Button>
          </div>
        </>
      )}

      {item.kind === 'ask' && q && q.kind !== 'text' && (
        <QuestionCard question={q} busy={busy} onAnswer={(a) => reply.mutate(a)} />
      )}

      {item.kind === 'ask' && (!q || q.kind === 'text') && (
        <p className={styles.prompt} id={promptId}>
          {item.prompt}
        </p>
      )}

      {item.kind === 'ask' && (
        <form
          className={styles.answer}
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) reply.mutate({ choices: [], text: answer.trim() });
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
            placeholder={q && q.kind !== 'text' ? 'Or type a reply…' : 'Type your answer…'}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
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

      {item.chatId && !inChat && (
        <Link className={styles.more} href={`/chat/${item.chatId}`}>
          Open chat
        </Link>
      )}
    </li>
  );
}
