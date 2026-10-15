"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useRunStream } from "@/hooks/use-run-stream";
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

  const { state, messages: liveMessages, start, reset } = useRunStream(onSettled);

  const send = useMutation({
    mutationFn: ({ text, model, fileIds }: { text: string; model: string; fileIds: string[] }) =>
      api.sendMessage(chatId, text, model, fileIds),
    onSuccess: ({ runId }) => {
      start(runId);
      void queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
    },
    onError: (err: Error) => toast.push({ title: "Could not send", message: err.message, tone: "error" }),
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
                Approving from the panel arrives in Phase 2. Until then, decide it on
                the LHOS approvals page.
              </p>
            </div>
          )}
        </div>

        <PromptBar
          busy={busy}
          onStop={() => stop.mutate()}
          chatId={chatId}
          onSend={(text, model, fileIds) => send.mutate({ text, model, fileIds })}
        />
      </main>

      <aside className={styles.rail} aria-label="Mission panel">
        <MissionRail run={state} chatId={chatId} />
      </aside>
    </>
  );
}
