"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartLine, Desktop, FileText } from "@phosphor-icons/react/dist/ssr";
import { Dot, Panel, Readout } from "@/components/ui";
import { Markdown } from "@/components/chat/markdown";
import { cn } from "@/lib/cn";
import styles from "./manage-view.module.css";

/**
 * Read-only Manage workspace. Service restart, sleep/wake and logs need the
 * host bridge (Phase 5) and are not offered here — a button that cannot act
 * would look like a broken control.
 */
type Section = "overview" | "activity" | "report";

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Desktop }> = [
  { id: "overview", label: "Overview", icon: Desktop },
  { id: "activity", label: "Activity", icon: ChartLine },
  { id: "report", label: "Report", icon: FileText },
];

interface Capabilities {
  reachable: boolean;
  waking?: boolean;
  desktopUp?: boolean;
  sandboxId?: string | null;
  rdpConnected?: boolean;
  pace?: string | null;
  pendingHumanRequests?: number;
  message?: string;
  capabilities?: {
    linux_browser?: { devtools_running?: boolean };
    pace?: { mode?: string; min_gap_s?: number; max_per_hour?: number };
    rdp?: { profile?: string | null; connected?: boolean };
  };
}

interface LhosEvent {
  iso?: string;
  tool: string;
  ms?: number;
  ok?: boolean;
  err?: string | null;
  images?: number;
  via?: string;
}

export function ManageView() {
  const [section, setSection] = useState<Section>("overview");

  return (
    <div className={styles.root}>
      <nav className={styles.nav} aria-label="Manage sections">
        <p className={styles.navLabel}>System</p>
        {SECTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={cn(styles.navItem, section === item.id && styles.navItemActive)}
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => setSection(item.id)}
            >
              <Icon size={16} weight={section === item.id ? "fill" : "regular"} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <main className={styles.main}>
        {section === "overview" && <Overview />}
        {section === "activity" && <Activity />}
        {section === "report" && <Report />}
      </main>
    </div>
  );
}

function Overview() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["lhos", "capabilities"],
    queryFn: () => fetchJson<Capabilities>("/api/lhos/capabilities"),
    refetchInterval: 15_000,
  });

  const desktopStatus = !data?.reachable
    ? data?.waking
      ? "warn"
      : "error"
    : data.desktopUp
      ? "live"
      : "warn";

  const desktopLabel = !data
    ? "Checking"
    : !data.reachable
      ? data.waking
        ? "Waking"
        : "Offline"
      : data.desktopUp
        ? "Desktop up"
        : "Asleep";

  return (
    <>
      <header className={styles.heading}>
        <h1>Overview</h1>
        <p>Live state of the agent computer. Restart, sleep and logs arrive with the host bridge.</p>
      </header>

      {isError && <p className={styles.error}>Could not read the agent computer.</p>}

      <div className={styles.grid}>
        <Panel
          title="Desktop"
          badge={<Dot status={isPending ? "pending" : desktopStatus} pulse={data?.desktopUp === true} />}
        >
          <p className={styles.stat}>{desktopLabel}</p>
          <p className={styles.meta}>
            {data?.sandboxId ? `Sandbox ${data.sandboxId}` : data?.message ?? "No sandbox id yet"}
          </p>
        </Panel>

        <Panel title="Pace" badge={<Dot status={data?.pace ? "ok" : "idle"} size="sm" />}>
          <div className={styles.readouts}>
            <Readout label="mode" value={data?.capabilities?.pace?.mode ?? data?.pace ?? "—"} size="sm" />
            <Readout
              label="gap"
              value={data?.capabilities?.pace?.min_gap_s ?? 0}
              unit="s"
              size="sm"
            />
            <Readout
              label="per hour"
              value={data?.capabilities?.pace?.max_per_hour ?? 0}
              size="sm"
            />
          </div>
        </Panel>

        <Panel
          title="Windows"
          badge={
            <Dot status={data?.rdpConnected ? "live" : "idle"} pulse={data?.rdpConnected === true} />
          }
        >
          <p className={styles.stat}>{data?.rdpConnected ? "RDP connected" : "RDP idle"}</p>
          <p className={styles.meta}>{data?.capabilities?.rdp?.profile ?? "No profile selected"}</p>
        </Panel>

        <Panel
          title="Waiting on you"
          badge={
            <Dot
              status={(data?.pendingHumanRequests ?? 0) > 0 ? "warn" : "ok"}
              pulse={(data?.pendingHumanRequests ?? 0) > 0}
            />
          }
        >
          <p className={styles.stat}>{data?.pendingHumanRequests ?? 0}</p>
          <p className={styles.meta}>Pending human requests on the agent computer</p>
        </Panel>
      </div>
    </>
  );
}

function Activity() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["lhos", "events"],
    queryFn: () => fetchJson<{ events: LhosEvent[] }>("/api/lhos/events?limit=40"),
    refetchInterval: 20_000,
  });

  const events = data?.events ?? [];

  return (
    <>
      <header className={styles.heading}>
        <h1>Activity</h1>
        <p>Latest tool calls on the agent computer, newest as the server returns them.</p>
      </header>

      {isPending && <p className={styles.meta}>Loading activity…</p>}
      {isError && <p className={styles.error}>Could not load the activity feed.</p>}

      {!isPending && events.length === 0 && <p className={styles.meta}>No events yet today.</p>}

      {events.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Tool</th>
                <th>Result</th>
                <th>ms</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, i) => (
                <tr key={`${event.iso ?? ""}-${event.tool}-${i}`}>
                  <td className={styles.mono}>{formatWhen(event.iso)}</td>
                  <td>{event.tool}</td>
                  <td>
                    <span className={styles.result}>
                      <Dot status={event.ok === false ? "error" : "ok"} size="sm" />
                      {event.ok === false ? event.err || "failed" : "ok"}
                    </span>
                  </td>
                  <td className={styles.mono}>{event.ms ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Report() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["lhos", "report"],
    queryFn: async () => {
      const res = await fetch("/api/lhos/report", { cache: "no-store" });
      if (!res.ok) throw new Error("report");
      return res.text();
    },
    staleTime: 60_000,
  });

  return (
    <>
      <header className={styles.heading}>
        <h1>Report</h1>
        <p>Today&apos;s generated activity report from the agent computer.</p>
      </header>
      {isPending && <p className={styles.meta}>Loading the report…</p>}
      {isError && <p className={styles.error}>Could not load today&apos;s report.</p>}
      {data && (
        <div className={styles.report}>
          <Markdown content={data} />
        </div>
      )}
    </>
  );
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(path);
  return res.json() as Promise<T>;
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
