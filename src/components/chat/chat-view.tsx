"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useRunStream } from "@/hooks/use-run-stream";
import { useSound } from "@/hooks/use-sound";
import { useDesktopNotify } from "@/hooks/use-desktop-notify";
import { PENDING_KEY } from "@/hooks/use-pending";
import { RUN_RESUMED_EVENT } from "@/lib/hitl";
import type { RunResumedDetail } from "@/lib/hitl";
import type { RunEvent } from "@/lib/run-events";
import { useToast } from "@/components/ui";
import { MissionRail } from "@/components/mission/mission-rail";
import { PromptBar } from "./prompt-bar";
import { Transcript } from "./transcript";
import styles from "./chat-view.module.css";

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
    queryKey: ["chat", chatId],
    queryFn: () => api.getChat(chatId),
  });

  const onSettled = useCallback(() => {
    // The run is over: refresh the persisted transcript and the sidebar's
    // status lines in one go.
    void queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
    void queryClient.invalidateQueries({ queryKey: ["chats"] });
  }, [chatId, queryClient]);

  const sound = useSound();
  const { notify } = useDesktopNotify();
  const title = data?.chat.title;

  const onEvent = useCallback(
    (event: RunEvent) => {
      switch (event.type) {
        case "approval_required":
          // The watcher announces it (toast, sound, notification) on its next
          // poll; fetch now so that happens immediately.
          void queryClient.invalidateQueries({ queryKey: PENDING_KEY });
          break;
        case "done":
          if (event.status === "done") {
            sound("done");
            notify("runDone", "Run finished", title ?? "The agent finished.", `/chat/${chatId}`);
          }
          break;
        case "error":
          sound("error");
          notify("runDone", "Run failed", event.message, `/chat/${chatId}`);
          break;
      }
    },
    [chatId, notify, queryClient, sound, title],
  );

  const { state, messages: liveMessages, start, resume, reset } = useRunStream(onSettled, onEvent);

  // A checkpoint decided in the Mission panel resumes the run server-side;
  // re-attach so the continuation streams into this transcript.
  useEffect(() => {
    const onResumed = (e: Event) => {
      const detail = (e as CustomEvent<RunResumedDetail>).detail;
      if (detail?.chatId !== chatId) return;
      resume(detail.runId);
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
    };
    window.addEventListener(RUN_RESUMED_EVENT, onResumed);
    return () => window.removeEventListener(RUN_RESUMED_EVENT, onResumed);
  }, [chatId, queryClient, resume]);

  const send = useMutation({
    mutationFn: ({ text, model, fileIds }: { text: string; model: string; fileIds: string[] }) =>
      api.sendMessage(chatId, text, model, fileIds),
    // Played inside the click's task, which also unlocks WebAudio for the
    // later cues (done, approval) that fire without a gesture.
    onMutate: () => sound("send"),
    onSuccess: ({ runId }) => {
      start(runId);
      void queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
      void queryClient.invalidateQueries({ queryKey: PENDING_KEY });
    },
    onError: (err: Error) => {
      sound("error");
      toast.push({ title: "Could not send", message: err.message, tone: "error" });
    },
  });

  const stop = useMutation({
    mutationFn: () => api.cancelRun(state.runId ?? ""),
    onError: (err: Error) => toast.push({ title: "Could not stop the run", message: err.message, tone: "error" }),
  });

  // Switching chats must not leave the previous run's stream attached.
  useEffect(() => reset, [chatId, reset]);

  /**
   * Persisted turns plus any this run has produced since. Deduplicated by id
   * because the refetch after a run lands includes the same rows.
   */
  const messages = useMemo(() => {
    const stored = data?.chat.messages ?? [];
    const seen = new Set(stored.map((m) => m.id));
    return [...stored, ...liveMessages.filter((m) => !seen.has(m.id))];
  }, [data?.chat.messages, liveMessages]);

  const busy = state.phase === "thinking" || state.phase === "tool" || state.phase === "waiting";

  // Follow the stream, but only while the owner is already near the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight });
  }, [messages.length, state.streamingText, state.steps.length]);

  return (
    <>
      <main className={styles.center}>
        <div className={styles.scroll} ref={scrollRef}>
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
            />
          )}

          {state.approval && (
            <div className={styles.approval} role="alert">
              <strong>Approval needed</strong>
              <p>
                The agent wants to run <code>{state.approval.tool}</code> — {state.approval.reason}.
                Nothing has run yet.
              </p>
              <p className={styles.approvalNote}>
                Approve or reject it under &ldquo;Waiting on you&rdquo; in the Mission panel.
              </p>
            </div>
          )}
        </div>

        <PromptBar
          busy={busy}
          onStop={() => stop.mutate()}
          chatId={chatId}
          chatModel={data?.chat.model ?? null}
          onSend={(text, model, fileIds) => send.mutate({ text, model, fileIds })}
        />
      </main>

      <aside className={styles.rail} aria-label="Mission panel">
        <MissionRail run={state} chatId={chatId} />
      </aside>
    </>
  );
}
