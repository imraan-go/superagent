"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Desktop } from "@phosphor-icons/react/dist/ssr";
import dynamic from "next/dynamic";
import { Dot, SegmentedSwitch, Skeleton } from "@/components/ui";
import type { RunState } from "@/hooks/use-run-stream";
import { MissionTab } from "./mission-tab";
import type { RailCapabilities } from "./mission-tab";
import styles from "./mission-rail.module.css";

/**
 * The live view carries Motion and the VNC framing; it loads as its own chunk
 * and stays mounted afterwards (see below).
 */
const ComputerTab = dynamic(() => import("./computer-tab").then((m) => m.ComputerTab), {
  loading: () => (
    <div role="status" aria-label="Loading computer view">
      <Skeleton shape="panel" height={220} />
    </div>
  ),
});
const LibraryTab = dynamic(() => import("./library-tab").then((m) => m.LibraryTab), {
  loading: () => (
    <div role="status" aria-label="Loading library">
      <Skeleton shape="panel" height={160} />
    </div>
  ),
});

/**
 * The right rail: a one-line identity header and three tabs. The body is ONE
 * scrolling column; panels inside size to their content and never shrink
 * (the old flex column collapsed them to their headers).
 */
type Tab = "mission" | "library" | "computer";

const TABS = [
  { value: "mission" as const, label: "Mission" },
  { value: "library" as const, label: "Library" },
  { value: "computer" as const, label: "Computer" },
];

interface Capabilities extends RailCapabilities {
  sandboxId?: string | null;
  pendingHumanRequests?: number;
}

export function MissionRail({ run, chatId }: { run: RunState; chatId?: string | null }) {
  const [tab, setTab] = useState<Tab>("mission");

  const { data: capabilities } = useQuery<Capabilities>({
    queryKey: ["lhos", "capabilities"],
    queryFn: async () => {
      const res = await fetch("/api/lhos/capabilities", { cache: "no-store" });
      if (!res.ok) throw new Error("capabilities");
      return res.json() as Promise<Capabilities>;
    },
    refetchInterval: 20_000,
  });

  const up = capabilities?.reachable === true && capabilities.desktopUp === true;
  const state = !capabilities
    ? "checking"
    : !capabilities.reachable
      ? capabilities.waking
        ? "waking"
        : "offline"
      : up
        ? "awake"
        : "asleep";

  return (
    <div className={styles.root}>
      <header className={styles.identity}>
        <span className={styles.avatar} aria-hidden>
          <Desktop size={18} weight="duotone" />
        </span>
        <div className={styles.idText}>
          <h2 className={styles.name}>Agent computer</h2>
          <p className={styles.sub} title={capabilities?.sandboxId ?? undefined}>
            {capabilities?.sandboxId ? capabilities.sandboxId.slice(0, 12) : "sandbox"}
          </p>
        </div>
        <span className={styles.state}>
          <Dot
            status={up ? "live" : capabilities?.reachable ? "warn" : capabilities ? "error" : "idle"}
            size="sm"
          />
          {state}
        </span>
      </header>

      <SegmentedSwitch<Tab>
        label="Mission panel section"
        size="sm"
        value={tab}
        onChange={setTab}
        options={TABS}
        className={styles.tabs}
      />

      <div className={styles.body}>
        {tab === "mission" && <MissionTab run={run} chatId={chatId} capabilities={capabilities} />}
        {tab === "library" && (
          <LibraryTab
            chatId={chatId}
            running={run.phase === "thinking" || run.phase === "tool" || run.phase === "waiting"}
          />
        )}
        {/* Always mounted: the live view keeps its connection while another tab shows. */}
        <div hidden={tab !== "computer"} className={styles.computerHost}>
          <ComputerTab
            capabilities={capabilities}
            active={tab === "computer"}
            steps={run.steps}
            runId={run.runId}
            onRequestOpen={() => setTab("computer")}
          />
        </div>
      </div>
    </div>
  );
}
