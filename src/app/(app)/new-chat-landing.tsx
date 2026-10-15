"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDots,
  ChartLineUp,
  Globe,
  Monitor,
  PlugsConnected,
  WindowsLogo,
} from "@phosphor-icons/react/dist/ssr";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Dot, LiveGlyph, useToast } from "@/components/ui";
import type { DotStatus } from "@/components/ui";
import { PromptBar } from "@/components/chat/prompt-bar";
import { prefillPrompt } from "@/components/chat/parts/composer";
import type { CapabilityId } from "@/components/chat/parts/composer";
import { MissionRail } from "@/components/mission/mission-rail";
import { RailAside, RailToggle, useRailDrawer } from "@/components/mission/rail-drawer";
import { IDLE_RUN } from "@/hooks/use-run-stream";
import styles from "./landing.module.css";

/**
 * Empty workspace: the agent's identity, its live instruments, and a handful
 * of things this owner actually asks for. Suggestions prefill the composer
 * rather than firing — the owner reads, tweaks, sends.
 */
const SUGGESTIONS: Array<{
  icon: typeof Monitor;
  title: string;
  sub: string;
  text: string;
  caps: CapabilityId[];
}> = [
  {
    icon: WindowsLogo,
    title: "Operate my Windows PC",
    sub: "Over RDP",
    text: "Connect to my Windows PC over RDP, open Chrome and tell me what's on screen.",
    caps: ["rdp"],
  },
  {
    icon: Globe,
    title: "Check LinkedIn notifications",
    sub: "Browser",
    text: "Open LinkedIn in the browser and summarise my unread notifications and messages.",
    caps: ["browser"],
  },
  {
    icon: ChartLineUp,
    title: "Summarise today's activity",
    sub: "Runs, tools, approvals",
    text: "Summarise everything the agent did today: runs, tools used, approvals, and anything that failed.",
    caps: [],
  },
  {
    icon: CalendarDots,
    title: "Schedule a daily inbox brief",
    sub: "Weekdays 08:00",
    text: "Create a schedule that runs every weekday at 08:00 and sends me a short brief of my unread inbox.",
    caps: ["connectors"],
  },
  {
    icon: Monitor,
    title: "Look at the computer",
    sub: "Linux desktop",
    text: "Take a screenshot of the agent computer and tell me what's open.",
    caps: ["computer"],
  },
  {
    icon: PlugsConnected,
    title: "Explore my MCP servers",
    sub: "Tools and ideas",
    text: "List the tools my MCP servers expose and suggest three automations I'd find useful.",
    caps: ["mcp"],
  },
];

interface LhosSnapshot {
  reachable?: boolean;
  waking?: boolean;
  desktopUp?: boolean;
  rdpConnected?: boolean;
  pace?: string | null;
  capabilities?: {
    api?: { connectors?: unknown[] };
    rdp?: { profile?: string | null };
    skills?: unknown[];
  };
}

async function fetchLhos(): Promise<LhosSnapshot> {
  const res = await fetch("/api/lhos/capabilities", { cache: "no-store" });
  if (!res.ok) throw new Error(`capabilities: ${res.status}`);
  return (await res.json()) as LhosSnapshot;
}

async function fetchMcp(): Promise<{ servers: unknown[] }> {
  const res = await fetch("/api/connectors/mcp", { cache: "no-store" });
  if (!res.ok) throw new Error(`mcp: ${res.status}`);
  return (await res.json()) as { servers: unknown[] };
}

export function NewChatLanding() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const drawer = useRailDrawer();

  const { data: lhos, isPending: lhosPending } = useQuery({
    queryKey: ["lhos", "capabilities"],
    queryFn: fetchLhos,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
  const { data: mcp } = useQuery({ queryKey: ["connectors", "mcp"], queryFn: fetchMcp, staleTime: 60_000 });

  const create = useMutation({
    mutationFn: async (input?: {
      text?: string;
      model?: string;
      fileIds?: string[];
      capabilities?: CapabilityId[];
    }) => {
      const { chat } = await api.createChat();
      if (input?.text || input?.fileIds?.length) {
        await api.sendMessage(chat.id, input.text ?? "", input.model, input.fileIds, input.capabilities);
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

  const computer: [DotStatus, string] = lhosPending
    ? ["pending", "checking"]
    : !lhos?.reachable
      ? lhos?.waking
        ? ["warn", "waking"]
        : ["error", "offline"]
      : lhos.desktopUp
        ? ["ok", "awake"]
        : ["idle", "asleep"];
  const rdp: [DotStatus, string] = lhos?.rdpConnected
    ? ["ok", lhos.capabilities?.rdp?.profile ?? "connected"]
    : ["idle", lhos?.reachable ? "standby" : "—"];
  const connectors = lhos?.capabilities?.api?.connectors?.length;
  const mcpCount = mcp?.servers.length;

  return (
    <>
      <main id="main" tabIndex={-1} className={styles.center}>
        <RailToggle drawer={drawer} />
        <div className={styles.scroll}>
          <div className={styles.hero}>
            <div className={styles.glyph}>
              <LiveGlyph state={create.isPending ? "thinking" : "idle"} size={64} label="" />
            </div>
            <p className={styles.eyebrow}>LHOS · super-agent</p>
            <h1 className={styles.title}>What should the agent do?</h1>
            <p className={styles.sub}>
              It drives a Linux computer and your Windows PC, calls your connectors and MCP
              servers, remembers what matters — and stops for your approval before anything
              irreversible.
            </p>

            <dl className={styles.status} aria-label="Agent status">
              <div className={styles.stat}>
                <dt>Computer</dt>
                <dd>
                  <Dot status={computer[0]} size="sm" pulse={computer[0] === "warn"} />
                  {computer[1]}
                </dd>
              </div>
              <div className={styles.stat}>
                <dt>Windows PC</dt>
                <dd>
                  <Dot status={rdp[0]} size="sm" />
                  {rdp[1]}
                </dd>
              </div>
              <div className={styles.stat}>
                <dt>Connectors</dt>
                <dd>{connectors ?? "—"}</dd>
              </div>
              <div className={styles.stat}>
                <dt>MCP servers</dt>
                <dd>{mcpCount ?? "—"}</dd>
              </div>
              {lhos?.pace && (
                <div className={styles.stat}>
                  <dt>Pace</dt>
                  <dd>{lhos.pace}</dd>
                </div>
              )}
            </dl>

            <ul className={styles.suggestions} aria-label="Suggestions">
              {SUGGESTIONS.map((s, i) => {
                const Icon = s.icon;
                return (
                  <li key={s.title} style={{ ["--i" as string]: i }}>
                    <button
                      type="button"
                      className={cn(styles.suggestion)}
                      disabled={create.isPending}
                      onClick={() => prefillPrompt({ text: s.text, capabilities: s.caps })}
                    >
                      <span className={styles.sugIcon} aria-hidden>
                        <Icon size={16} />
                      </span>
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
          onSend={(text, model, fileIds, capabilities) =>
            create.mutate({ text, model, fileIds, capabilities })
          }
        />
      </main>

      <RailAside drawer={drawer}>
        <MissionRail run={IDLE_RUN} />
      </RailAside>
    </>
  );
}
