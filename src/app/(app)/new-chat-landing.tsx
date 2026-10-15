"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { LiveGlyph, useToast } from "@/components/ui";
import { PromptBar } from "@/components/chat/prompt-bar";
import { MissionRail } from "@/components/mission/mission-rail";
import { IDLE_RUN } from "@/hooks/use-run-stream";
import styles from "./landing.module.css";

/**
 * Empty workspace. The owner types once — the first send creates the chat and
 * hands off, matching the Grok Bot landing (prompt bar always present, right
 * rail always present).
 */
const SUGGESTIONS = [
  "Take a screenshot and tell me what's on screen",
  "Open Firefox and check the top story on Hacker News",
  "What can you do on this computer?",
];

export function NewChatLanding() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  const create = useMutation({
    mutationFn: async (input?: { text?: string; model?: string; fileIds?: string[] }) => {
      const { chat } = await api.createChat();
      if (input?.text || input?.fileIds?.length) {
        await api.sendMessage(chat.id, input.text ?? "", input.model, input.fileIds);
      }
      return chat.id;
    },
    onSuccess: async (chatId) => {
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      router.push(`/chat/${chatId}`);
    },
    onError: (err: Error) =>
      toast.push({ title: "Could not start a chat", message: err.message, tone: "error" }),
  });

  return (
    <>
      <main className={styles.center}>
        <div className={styles.scroll}>
          <div className={styles.hero}>
            <LiveGlyph state="idle" size={56} label="" />
            <h1 className={styles.title}>What should the agent do?</h1>
            <p className={styles.sub}>
              It drives a real Linux desktop. Irreversible actions stop for your approval.
            </p>

            <div className={styles.suggestions}>
              {SUGGESTIONS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className={styles.suggestion}
                  disabled={create.isPending}
                  onClick={() => create.mutate({ text: prompt })}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>

        <PromptBar
          busy={create.isPending}
          onStop={() => undefined}
          onSend={(text, model, fileIds) => create.mutate({ text, model, fileIds })}
        />
      </main>

      <aside className={styles.rail} aria-label="Mission panel">
        <MissionRail run={IDLE_RUN} />
      </aside>
    </>
  );
}
