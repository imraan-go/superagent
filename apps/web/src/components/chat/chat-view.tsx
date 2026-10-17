'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown } from '@phosphor-icons/react/dist/ssr';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useRunStream } from '@/hooks/use-run-stream';
import { useSound } from '@/hooks/use-sound';
import { useDesktopNotify } from '@/hooks/use-desktop-notify';
import { PENDING_KEY } from '@/hooks/use-pending';
import { STATUS_KEY } from '@/hooks/use-capabilities';
import { RUN_RESUMED_EVENT } from '@/lib/hitl';
import { describeRun } from '@/lib/announce';
import type { RunResumedDetail } from '@/lib/hitl';
import type { RunEvent } from '@/lib/run-events';
import { useToast } from '@/components/ui';
import { RailAside, RailToggle, useRailDrawer } from '@/components/mission/rail-drawer';
import { MissionRail } from '@/components/mission/mission-rail';
import { PromptBar } from './prompt-bar';
import type { CapabilityId } from './parts/composer';
import type { SendOptions } from './prompt-bar';
import type { ChatPrefs } from '@/lib/chat-mode';
import { Transcript } from './transcript';
import styles from './chat-view.module.css';

/**
 * One chat: transcript, prompt bar and the Mission rail that reflects the same
 * run state. The rail lives here rather than in the layout because it is a view
 * of *this* run, not of the app.
 */
export function ChatView({ chatId }: { chatId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data, isPending } = useQuery({
    queryKey: ['chat', chatId],
    queryFn: () => api.getChat(chatId),
  });

  const onSettled = useCallback(() => {
    // The run is over: refresh the persisted transcript and the sidebar's
    // status lines in one go.
    void queryClient.invalidateQueries({ queryKey: ['chat', chatId] });
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
    void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
  }, [chatId, queryClient]);

  const sound = useSound();
  const { notify } = useDesktopNotify();
  const title = data?.chat.title;

  const onEvent = useCallback(
    (event: RunEvent) => {
      switch (event.type) {
        case 'approval_required':
          // The watcher announces it (toast, sound, notification) on its next
          // poll; fetch now so that happens immediately.
          void queryClient.invalidateQueries({ queryKey: PENDING_KEY });
          break;
        case 'done':
          if (event.status === 'done') {
            sound('done');
            notify('runDone', 'Run finished', title ?? 'The agent finished.', `/chat/${chatId}`);
          }
          break;
        case 'error':
          sound('error');
          notify('runDone', 'Run failed', event.message, `/chat/${chatId}`);
          break;
      }
    },
    [chatId, notify, queryClient, sound, title],
  );

  const { state, messages: liveMessages, start, resume, reset, markAnswered } = useRunStream(onSettled, onEvent);

  // A checkpoint decided in the Mission panel resumes the run server-side;
  // re-attach so the continuation streams into this transcript.
  useEffect(() => {
    const onResumed = (e: Event) => {
      const detail = (e as CustomEvent<RunResumedDetail>).detail;
      if (detail?.chatId !== chatId) return;
      resume(detail.runId);
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    };
    window.addEventListener(RUN_RESUMED_EVENT, onResumed);
    return () => window.removeEventListener(RUN_RESUMED_EVENT, onResumed);
  }, [chatId, queryClient, resume]);

  const send = useMutation({
    mutationFn: ({
      text,
      model,
      fileIds,
      capabilities,
      options,
    }: {
      text: string;
      model?: string;
      fileIds: string[];
      capabilities?: CapabilityId[];
      options?: SendOptions;
    }) =>
      api.sendMessage(
        chatId,
        text,
        model,
        fileIds,
        capabilities,
        options?.mode ?? data?.chat.prefs?.mode,
        options?.capabilitiesAuto,
      ),
    // Played inside the click's task, which also unlocks WebAudio for the
    // later cues (done, approval) that fire without a gesture.
    onMutate: () => sound('send'),
    onSuccess: ({ runId, answered }, vars) => {
      if (answered) {
        markAnswered(answered, { choices: [], text: vars.text });
        if (state.runId !== runId) start(runId);
      } else start(runId);
      void queryClient.invalidateQueries({ queryKey: ['chat', chatId] });
      void queryClient.invalidateQueries({ queryKey: PENDING_KEY });
    },
    onError: (err: Error) => {
      sound('error');
      toast.push({ title: 'Could not send', message: err.message, tone: 'error' });
    },
  });

  const answer = useMutation({
    mutationFn: ({ questionId, choices, text }: { questionId: string; choices: string[]; text?: string }) =>
      api.answerQuestion(chatId, questionId, choices, text),
    onMutate: ({ questionId, choices, text }) => markAnswered(questionId, { choices, ...(text ? { text } : {}) }),
    onSuccess: ({ runId }) => {
      // The run continues under the same id; make sure this view is following it.
      if (state.runId !== runId) start(runId);
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      void queryClient.invalidateQueries({ queryKey: PENDING_KEY });
    },
    onError: (err: Error) => {
      toast.push({ title: 'Could not send your answer', message: err.message, tone: 'error' });
      void queryClient.invalidateQueries({ queryKey: ['chat', chatId] });
    },
  });

  const savePrefs = useMutation({
    mutationFn: (prefs: ChatPrefs) => api.updateChat(chatId, prefs),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['chat', chatId] }),
    onError: (err: Error) => toast.push({ title: 'Could not save the mode', message: err.message, tone: 'error' }),
  });

  const stop = useMutation({
    mutationFn: () => api.cancelRun(state.runId ?? ''),
    onError: (err: Error) => toast.push({ title: 'Could not stop the run', message: err.message, tone: 'error' }),
  });

  // Switching chats must not leave the previous run's stream attached.
  useEffect(() => reset, [chatId, reset]);

  // Arriving at a chat whose run is still going (from the landing page, a reload or another
  // tab): attach to it so steps, questions and the answer stream in.
  const activeRunId = data?.chat.activeRunId ?? null;
  useEffect(() => {
    if (activeRunId && state.runId !== activeRunId && state.phase !== 'thinking' && state.phase !== 'tool')
      start(activeRunId);
  }, [activeRunId, start, state.phase, state.runId]);

  /**
   * Persisted turns plus any this run has produced since. Deduplicated by id
   * because the refetch after a run lands includes the same rows.
   */
  const messages = useMemo(() => {
    const stored = data?.chat.messages ?? [];
    const seen = new Set(stored.map((m) => m.id));
    return [...stored, ...liveMessages.filter((m) => !seen.has(m.id))];
  }, [data?.chat.messages, liveMessages]);

  const drawer = useRailDrawer();

  // Announce run transitions (never tokens) to assistive tech.
  const announcement = useMemo(
    () => describeRun(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- transitions only
    [state.phase, state.activity, state.approval?.tool, state.error],
  );

  const busy = state.phase === 'thinking' || state.phase === 'tool' || state.phase === 'waiting';
  const awaitingAnswer = state.question?.status === 'pending' || Boolean(data?.chat.pendingQuestion);

  // Follow the stream only while the owner is pinned near the bottom; once
  // they scroll up, offer a "jump to latest" pill instead of yanking them.
  const [pinned, setPinned] = useState(true);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 160);
  }, []);
  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinned) return;
    el.scrollTo({ top: el.scrollHeight });
  }, [pinned, messages.length, state.streamingText, state.steps]);

  // Late growth (markdown chunk, highlighted code, thumbnails) keeps a pinned
  // view at the bottom too.
  useEffect(() => {
    const el = scrollRef.current;
    const content = el?.firstElementChild;
    if (!el || !content || !pinned || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => el.scrollTo({ top: el.scrollHeight }));
    ro.observe(content);
    return () => ro.disconnect();
  }, [pinned, isPending]);

  const lastUserText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m?.role === 'user') return m;
    }
    return null;
  }, [messages]);

  return (
    <>
      <main id="main" tabIndex={-1} className={styles.center} data-running={busy || undefined}>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
        <RailToggle drawer={drawer} />
        <div className={styles.scroll} ref={scrollRef} onScroll={onScroll}>
          {isPending ? (
            <p className={styles.loading}>Loading chat…</p>
          ) : (
            <Transcript
              messages={messages}
              streamingText={state.streamingText}
              steps={state.steps}
              activity={state.activity}
              phase={state.phase}
              error={state.error}
              runId={state.runId}
              usage={state.usage}
              approval={state.approval}
              mode={data?.chat.prefs?.mode}
              streamingThinking={state.streamingThinking}
              debug={state.debug}
              errorCode={state.errorCode}
              question={state.question}
              answering={answer.isPending}
              onAnswer={(q, a) => answer.mutate({ questionId: q.questionId, ...a })}
              onRetry={busy || send.isPending ? undefined : (text) => send.mutate({ text, fileIds: [] })}
              onContinue={
                busy || send.isPending || !lastUserText
                  ? undefined
                  : () => send.mutate({ text: 'Continue from where you left off.', fileIds: [] })
              }
            />
          )}
          {!pinned && (
            <button type="button" className={styles.jump} onClick={jumpToLatest}>
              <ArrowDown size={13} weight="bold" aria-hidden />
              Jump to latest
            </button>
          )}
        </div>

        <PromptBar
          busy={busy}
          placeholder={awaitingAnswer ? 'Type your answer…' : undefined}
          onStop={() => stop.mutate()}
          chatId={chatId}
          chatModel={data?.chat.model ?? null}
          initialPrefs={data?.chat.prefs ?? null}
          onPrefsChange={(prefs) => savePrefs.mutate(prefs)}
          autoPick={state.capabilities?.auto ? state.capabilities : null}
          onSend={(text, model, fileIds, capabilities, options) =>
            send.mutate({ text, model, fileIds, capabilities, options })
          }
        />
      </main>

      <RailAside drawer={drawer} phase={state.phase}>
        <MissionRail run={state} chatId={chatId} />
      </RailAside>
    </>
  );
}
