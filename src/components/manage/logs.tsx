"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Dot } from "@/components/ui";
import { grepLines, MAX_LOG_LINES } from "@/lib/manage/log-follow";
import { apiGet, ManageApiError } from "./api";
import { ErrorNote, SectionHeader, SkeletonRows } from "./shared";
import styles from "./shared.module.css";

const UNITS = [
  "e2b-infra",
  "e2b-api",
  "e2b-orchestrator",
  "e2b-client-proxy",
  "e2b-firewall",
  "e2b-desktop-vnc",
  "e2b-mcp",
  "e2b-scheduler",
  "caddy",
] as const;

type Unit = (typeof UNITS)[number];

export function Logs() {
  const [unit, setUnit] = useState<Unit>("e2b-api");
  const [follow, setFollow] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("");

  return (
    <>
      <SectionHeader title="Logs">
        Journal for each managed unit. Follow mode streams new lines every 2 seconds.
      </SectionHeader>

      <div className={styles.tabs} role="group" aria-label="Unit">
        {UNITS.map((u) => (
          <Button key={u} size="sm" variant={u === unit ? "primary" : "outline"} aria-pressed={u === unit} onClick={() => setUnit(u)}>
            {u}
          </Button>
        ))}
      </div>

      <div className={styles.toolbar}>
        <label className={styles.label}>
          Filter
          <input
            className={`${styles.input} ${styles.monoInput}`}
            placeholder="grep…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
      </div>

      {follow ? (
        <FollowLog key={unit} unit={unit} filter={filter} autoScroll={autoScroll} />
      ) : (
        <StaticLog key={unit} unit={unit} filter={filter} autoScroll={autoScroll} />
      )}
    </>
  );
}

function LogBox({ lines, filter, autoScroll }: { lines: string[]; filter: string; autoScroll: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  const shown = useMemo(() => grepLines(lines, filter), [lines, filter]);

  useEffect(() => {
    if (autoScroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [shown, autoScroll]);

  return (
    <pre ref={ref} className={styles.logBox} tabIndex={0} aria-label="Log output">
      {shown.length === 0 ? (
        <span className={styles.empty}>{lines.length === 0 ? "No log lines." : "No lines match the filter."}</span>
      ) : (
        shown.map((l, i) => (
          <div key={i} className={styles.logLine}>
            {l}
          </div>
        ))
      )}
    </pre>
  );
}

function StaticLog({ unit, filter, autoScroll }: { unit: Unit; filter: string; autoScroll: boolean }) {
  const query = useQuery({
    queryKey: ["manage", "logs", unit],
    queryFn: async () => (await apiGet<{ lines: string[] }>(`/api/manage/logs/${unit}?n=200`)).lines,
  });
  return (
    <>
      {query.isError && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}
      {query.isPending && <SkeletonRows rows={10} height={18} />}
      {query.data && (
        <>
          <LogBox lines={query.data} filter={filter} autoScroll={autoScroll} />
          <div className={styles.row} style={{ marginTop: "var(--sp-2)" }}>
            <Button size="sm" variant="ghost" loading={query.isFetching} onClick={() => void query.refetch()}>
              Refresh
            </Button>
            <span className={styles.mono}>last {query.data.length} lines</span>
          </div>
        </>
      )}
    </>
  );
}

function FollowLog({ unit, filter, autoScroll }: { unit: Unit; filter: string; autoScroll: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "problem">("connecting");

  useEffect(() => {
    const es = new EventSource(`/api/manage/logs/${unit}/stream`);
    es.addEventListener("lines", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent<string>).data) as { lines: string[] };
        setStatus("live");
        setLines((prev) => [...prev, ...data.lines].slice(-MAX_LOG_LINES));
      } catch {
        // ignore a malformed frame
      }
    });
    es.addEventListener("problem", () => setStatus("problem"));
    es.onerror = () => setStatus("problem");
    return () => es.close();
  }, [unit]);

  return (
    <>
      {status === "problem" && (
        <ErrorNote error={new ManageApiError("bridge_unavailable", "Reconnecting…", 502)} />
      )}
      <p className={styles.row} style={{ margin: "0 0 var(--sp-2)" }}>
        <Dot status={status === "live" ? "live" : status === "problem" ? "error" : "pending"} size="sm" pulse={status === "live"} />
        <span className={styles.mono}>{status === "live" ? "following" : status === "problem" ? "reconnecting" : "connecting"}</span>
      </p>
      <LogBox lines={lines} filter={filter} autoScroll={autoScroll} />
    </>
  );
}
