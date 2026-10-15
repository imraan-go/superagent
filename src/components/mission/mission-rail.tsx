"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Desktop } from "@phosphor-icons/react/dist/ssr";
import dynamic from "next/dynamic";
import { Dot, Panel, Readout, SegmentedSwitch, Skeleton } from "@/components/ui";
import { formatCost } from "@/lib/format";
import { useUsageTicker } from "@/hooks/use-usage-ticker";
import type { RunState } from "@/hooks/use-run-stream";
import { WaitingPanel } from "@/components/hitl/waiting-panel";
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
 * The right rail: one identity block and three tabs
 * (DESIGN_SYSTEM §Reference reading — 360px cannot hold these stacked).
 */
type Tab = "mission" | "library" | "computer";

const TABS = [
  { value: "mission" as const, label: "Mission" },
  { value: "library" as const, label: "Library" },
  { value: "computer" as const, label: "Computer" },
];

interface Capabilities {
  reachable: boolean;
  waking?: boolean;
  desktopUp?: boolean;
  sandboxId?: string | null;
  pace?: string | null;
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

  return (
    <div className={styles.root}>
      <header className={styles.identity}>
        <span className={styles.avatar} aria-hidden>
          <Desktop size={26} weight="duotone" />
        </span>
        <h2 className={styles.name}>Agent computer</h2>
        <p className={styles.sub}>
          {capabilities?.sandboxId
            ? `Sandbox ${capabilities.sandboxId.slice(0, 10)}…`
            : "The desktop this agent drives"}
        </p>
        <button type="button" className={styles.labelBtn} disabled>
          Add a label
        </button>
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
        {tab === "mission" && <MissionTab run={run} chatId={chatId} />}
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

function MissionTab({
  run,
  chatId,
}: {
  run: RunState;
  chatId?: string | null;
}) {
  const { summary, live } = useUsageTicker(chatId);
  const today = summary?.today;
  return (
    <>
      {/* First: a decision the owner owes outranks every readout. */}
      <WaitingPanel />
      <Panel
        title="Spend today"
        badge={<Dot status={live ? "live" : "idle"} size="sm" pulse={live && run.phase !== "idle"} />}
      >
        <div className={styles.readouts}>
          <Readout label="cost" prefix="$" value={today?.costUsd ?? 0} precision={4} size="md" tone="signal" />
          <Readout label="tokens in" value={today?.tokensIn ?? 0} size="sm" />
          <Readout label="tokens out" value={today?.tokensOut ?? 0} size="sm" />
        </div>
        <p className={styles.cost}>
          {summary?.chat
            ? `${formatCost(summary.chat.costUsd)} this chat · ${today?.calls ?? 0} model calls today`
            : `${today?.calls ?? 0} model calls today`}
        </p>
      </Panel>

      <Panel title="Usage" badge={<Dot status={run.usage ? "ok" : "idle"} size="sm" />}>
        <div className={styles.readouts}>
          <Readout label="tokens in" value={run.usage?.tokensIn ?? 0} size="sm" />
          <Readout label="tokens out" value={run.usage?.tokensOut ?? 0} size="sm" />
        </div>
        <p className={styles.cost}>{formatCost(run.usage?.costUsd ?? 0)} this run</p>
      </Panel>

      <Panel title="Steps">
        {run.steps.length === 0 ? (
          <p className={styles.muted}>No tools used yet.</p>
        ) : (
          <ol className={styles.steps}>
            {run.steps.map((step) => (
              <li key={step.idx}>
                <Dot
                  status={step.ok === null ? "pending" : step.ok ? "ok" : "error"}
                  size="sm"
                  pulse={step.ok === null}
                />
                <span className={styles.stepName}>{step.toolName ?? step.label}</span>
                {step.ms !== null && <span className={styles.stepMs}>{step.ms}ms</span>}
              </li>
            ))}
          </ol>
        )}
      </Panel>

    </>
  );
}
