"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Desktop, Monitor } from "@phosphor-icons/react/dist/ssr";
import { Button, Dot, Panel, Readout, SegmentedSwitch } from "@/components/ui";
import { formatCost } from "@/lib/format";
import type { RunState } from "@/hooks/use-run-stream";
import styles from "./mission-rail.module.css";

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

export function MissionRail({ run }: { run: RunState }) {
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
        {tab === "mission" && <MissionTab run={run} capabilities={capabilities} />}
        {tab === "library" && <LibraryTab />}
        {tab === "computer" && <ComputerTab capabilities={capabilities} />}
      </div>
    </div>
  );
}

function MissionTab({
  run,
  capabilities,
}: {
  run: RunState;
  capabilities?: Capabilities;
}) {
  return (
    <>
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

      {(capabilities?.pendingHumanRequests ?? 0) > 0 && (
        <Panel title="Waiting on you" badge={<Dot status="warn" size="sm" pulse />}>
          <p className={styles.muted}>
            {capabilities?.pendingHumanRequests} request(s) pending on the agent
            computer. The approvals view arrives in Phase 2.
          </p>
        </Panel>
      )}
    </>
  );
}

function LibraryTab() {
  return (
    <Panel title="Library">
      <p className={styles.muted}>
        Files and artifacts this chat produces will collect here. Uploads and tool
        screenshots land in Phase 2.
      </p>
    </Panel>
  );
}

function ComputerTab({ capabilities }: { capabilities?: Capabilities }) {
  const asleep = capabilities?.reachable && !capabilities.desktopUp;

  return (
    <Panel
      title="Screen"
      badge={
        <Dot
          status={
            !capabilities?.reachable ? "error" : capabilities.desktopUp ? "live" : "warn"
          }
          size="sm"
          pulse={capabilities?.desktopUp === true}
        />
      }
    >
      <div className={styles.screen} data-state={asleep ? "asleep" : capabilities?.desktopUp ? "live" : "offline"}>
        <span className={styles.screenGlyph} aria-hidden>
          <Monitor size={32} weight="duotone" />
        </span>
        <p className={styles.screenLabel}>
          {!capabilities?.reachable
            ? "Cannot reach the agent computer"
            : asleep
              ? "Computer is asleep"
              : "Desktop is up"}
        </p>
        {asleep && (
          <Button size="sm" variant="outline" disabled>
            Wake
          </Button>
        )}
      </div>
      <p className={styles.screenCaption}>Agent computer&apos;s screen</p>
      <p className={styles.muted}>The live view arrives with the VNC panel in Phase 2.</p>
    </Panel>
  );
}
