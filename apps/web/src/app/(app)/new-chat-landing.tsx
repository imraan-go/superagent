"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChartLineUp } from "@phosphor-icons/react/dist/ssr";
import { api } from "@/lib/api";
import { openApps } from "@/lib/app-events";
import { useConnectedApps } from "@/components/apps/use-composio";
import { cn } from "@/lib/cn";
import { CategoryTile, Dot, LiveGlyph, useToast } from "@/components/ui";
import type { DotStatus, TileCategory } from "@/components/ui";
import { PromptBar } from "@/components/chat/prompt-bar";
import type { SendOptions } from "@/components/chat/prompt-bar";
import { prefillPrompt } from "@/components/chat/parts/composer";
import type { CapabilityId } from "@/components/chat/parts/composer";
import { MissionRail } from "@/components/mission/mission-rail";
import { RailAside, RailToggle, useRailDrawer } from "@/components/mission/rail-drawer";
import { IDLE_RUN } from "@/hooks/use-run-stream";
import { STATE_LABEL, useCapabilities } from "@/hooks/use-capabilities";
import styles from "./landing.module.css";

/**
 * Empty workspace: the agent's identity, its live instruments, and a handful
 * of things this owner actually asks for. Suggestions prefill the composer
 * rather than firing — the owner reads, tweaks, sends.
 */
const SUGGESTIONS: Array<{
  cat: TileCategory;
  icon?: typeof ChartLineUp;
  title: string;
  sub: string;
  text: string;
  caps: CapabilityId[];
}> = [
  {
    cat: "schedule",
    title: "Check my inbox every morning",
    sub: "Routine · weekdays 08:00",
    text: "Every weekday at 08:00, check my Gmail and tell me only about important new mail.",
    caps: [],
  },
  {
    cat: "browser",
    title: "Research a topic on the web",
    sub: "Cloud browser",
    text: "Read https://en.wikipedia.org/wiki/Temporal_(software) and summarise it in five bullet points.",
    caps: ["browser"],
  },
  {
    cat: "shell",
    title: "Crunch some numbers",
    sub: "Python in your workspace",
    text: "Write and run a short Python script that compares 5% vs 7% annual growth on $10,000 over 20 years, then save the table as a CSV I can download.",
    caps: ["computer"],
  },
  {
    cat: "think",
    icon: ChartLineUp,
    title: "Plan my week",
    sub: "Asks you first",
    text: "Help me plan my week. Ask me a couple of quick questions first (use options I can pick from).",
    caps: [],
  },
  {
    cat: "connector",
    title: "What's on my calendar?",
    sub: "Connected apps",
    text: "What do I have on my Google Calendar for the next three days?",
    caps: ["connectors"],
  },
  {
    cat: "memory",
    title: "Remember a preference",
    sub: "Memory",
    text: "Remember this about me: I prefer short answers with bullet points.",
    caps: ["memory"],
  },
];

export function NewChatLanding() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const drawer = useRailDrawer();

  const { capabilities: status, state } = useCapabilities();
  const create = useMutation({
    mutationFn: async (input?: {
      text?: string;
      model?: string;
      fileIds?: string[];
      capabilities?: CapabilityId[];
      options?: SendOptions;
    }) => {
      const { chat } = await api.createChat();
      if (input?.text || input?.fileIds?.length) {
        await api.sendMessage(
          chat.id,
          input.text ?? "",
          input.model,
          input.fileIds,
          input.capabilities,
          input.options?.mode,
          input.options?.capabilitiesAuto,
        );
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

  const caps = status?.capabilities;
  const ready = (k: string): [DotStatus, string] => (!caps ? ["pending", "…"] : caps[k]?.configured ? ["ok", "ready"] : ["idle", "not set up"]);
  const agent: [DotStatus, string] = [
    state === "working" ? "live" : state === "ready" ? "ok" : state === "checking" ? "pending" : state === "setup" ? "warn" : "error",
    STATE_LABEL[state],
  ];
  const workspace = ready("e2b_code");
  const browser = ready("e2b_browser");
  const { count, loading: appsLoading } = useConnectedApps();
  const appCount = appsLoading ? null : count;

  return (
    <>
      <main id="main" tabIndex={-1} className={styles.center}>
        <RailToggle drawer={drawer} />
        <div className={styles.scroll}>
          <div className={styles.hero}>
            <div className={styles.glyph}>
              <LiveGlyph state={create.isPending ? "thinking" : "idle"} size={64} label="" className={styles.heroGlyph} />
            </div>
            <p className={styles.eyebrow}>Superagent</p>
            <h1 className={styles.title}>What should the agent do?</h1>
            <p className={styles.sub}>
              It works in a private cloud workspace and browser, reads your connected apps, can run on a schedule, asks
              when a choice is yours — and stops for your exact approval before anything leaves your account.
            </p>

            <dl className={styles.status} aria-label="Agent status">
              <div className={styles.stat} data-cat="agent">
                <dt>Agent</dt>
                <dd>
                  <Dot status={agent[0]} size="sm" pulse={agent[0] === "live"} />
                  {agent[1]}
                </dd>
              </div>
              <div className={styles.stat} data-cat="screen">
                <dt>Workspace</dt>
                <dd>
                  <Dot status={workspace[0]} size="sm" />
                  {workspace[1]}
                </dd>
              </div>
              <div className={styles.stat} data-cat="browser">
                <dt>Browser</dt>
                <dd>
                  <Dot status={browser[0]} size="sm" />
                  {browser[1]}
                </dd>
              </div>
              <div className={styles.stat} data-cat="connector">
                <dt>Apps</dt>
                <dd>
                  <button type="button" className={styles.statBtn} onClick={() => openApps()} aria-label={`${appCount} connected apps. Connect apps`}>
                    {appCount ?? "—"}
                    <span className={styles.statAction}>{appCount === 0 ? "connect" : "manage"}</span>
                  </button>
                </dd>
              </div>
            </dl>

            <ul className={styles.suggestions} aria-label="Suggestions">
              {SUGGESTIONS.map((s, i) => {
                return (
                  <li key={s.title} style={{ ["--i" as string]: i }}>
                    <button
                      type="button"
                      className={cn(styles.suggestion)}
                      data-cat={s.cat}
                      disabled={create.isPending}
                      onClick={() => prefillPrompt({ text: s.text, capabilities: s.caps })}
                    >
                      <CategoryTile cat={s.cat} icon={s.icon} size="md" />
                      <span className={styles.sugText}>
                        <span className={styles.sugTitle}>{s.title}</span>
                        <span className={styles.sugSub}>{s.sub}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <PromptBar
          busy={create.isPending}
          onStop={() => undefined}
          onSend={(text, model, fileIds, capabilities, options) =>
            create.mutate({ text, model, fileIds, capabilities, options })
          }
        />
      </main>

      <RailAside drawer={drawer}>
        <MissionRail run={IDLE_RUN} />
      </RailAside>
    </>
  );
}
