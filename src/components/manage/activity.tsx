"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dot, SegmentedSwitch, useToast } from "@/components/ui";
import { Markdown } from "@/components/chat/markdown";
import { apiGet, apiPost, apiText } from "./api";
import { ErrorNote, formatWhen, SectionHeader, SkeletonRows } from "./shared";
import styles from "./shared.module.css";

type Tab = "events" | "reports";
const PAGE = 50;

export function Activity() {
  const [tab, setTab] = useState<Tab>("events");
  return (
    <>
      <SectionHeader title="Activity & reports">
        Tool calls on the agent computer, and the daily activity reports.
      </SectionHeader>
      <div className={styles.toolbar}>
        <SegmentedSwitch
          label="Activity view"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "events", label: "Events" },
            { value: "reports", label: "Reports" },
          ]}
        />
      </div>
      {tab === "events" ? <Events /> : <Reports />}
    </>
  );
}

interface LhosEvent {
  ts: number;
  iso?: string;
  tool: string;
  ms?: number;
  ok?: boolean;
  err?: string | null;
  client?: string;
  via?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

function Events() {
  const [date, setDate] = useState(today);
  const [tool, setTool] = useState("");
  const [result, setResult] = useState<"all" | "ok" | "fail">("all");
  const [client, setClient] = useState("");
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ["manage", "events", date],
    queryFn: () => apiGet<{ events: LhosEvent[] }>(`/api/lhos/events?date=${date}&limit=2000`),
    refetchInterval: date === today() ? 20_000 : false,
  });

  // The server returns oldest-first; the feed reads newest-first.
  const all = useMemo(() => [...(query.data?.events ?? [])].sort((a, b) => b.ts - a.ts), [query.data]);
  const tools = useMemo(() => [...new Set(all.map((e) => e.tool))].sort(), [all]);
  const clients = useMemo(() => [...new Set(all.map((e) => e.client).filter((c): c is string => !!c))].sort(), [all]);
  const filtered = useMemo(
    () =>
      all.filter(
        (e) =>
          (!tool || e.tool === tool) &&
          (!client || e.client === client) &&
          (result === "all" || (result === "ok" ? e.ok !== false : e.ok === false)),
      ),
    [all, tool, client, result],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const rows = filtered.slice(current * PAGE, current * PAGE + PAGE);
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };

  return (
    <>
      <div className={styles.toolbar}>
        <label className={styles.label}>
          Date (UTC)
          <input type="date" className={styles.input} value={date} max={today()} onChange={(e) => e.target.value && reset(setDate)(e.target.value)} />
        </label>
        <label className={styles.label}>
          Tool
          <select className={styles.select} value={tool} onChange={(e) => reset(setTool)(e.target.value)}>
            <option value="">All tools</option>
            {tools.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className={styles.label}>
          Result
          <select className={styles.select} value={result} onChange={(e) => reset(setResult)(e.target.value as typeof result)}>
            <option value="all">All</option>
            <option value="ok">OK</option>
            <option value="fail">Failed</option>
          </select>
        </label>
        <label className={styles.label}>
          Client
          <select className={styles.select} value={client} onChange={(e) => reset(setClient)(e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      {query.isError && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}
      {query.isPending && <SkeletonRows rows={8} height={32} />}
      {query.data && filtered.length === 0 && <p className={styles.empty}>No events match.</p>}

      {rows.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Tool</th>
                <th>Result</th>
                <th>ms</th>
                <th>Client</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={`${e.ts}-${e.tool}-${i}`}>
                  <td className={`${styles.mono} ${styles.nowrap}`}>{formatWhen(e.iso)}</td>
                  <td className={styles.nowrap}>{e.tool}</td>
                  <td className={styles.wrapCell}>
                    <span className={styles.cell}>
                      <Dot status={e.ok === false ? "error" : "ok"} size="sm" />
                      {e.ok === false ? e.err || "failed" : "ok"}
                    </span>
                  </td>
                  <td className={styles.mono}>{e.ms ?? "—"}</td>
                  <td className={styles.mono}>{e.client ?? e.via ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > PAGE && (
        <div className={styles.row} style={{ marginTop: "var(--sp-3)" }}>
          <Button size="sm" variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Newer
          </Button>
          <span className={styles.mono}>
            {current + 1} / {pages} · {filtered.length} events
          </span>
          <Button size="sm" variant="outline" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Older
          </Button>
        </div>
      )}
    </>
  );
}

function Reports() {
  const toast = useToast();
  const qc = useQueryClient();
  const [date, setDate] = useState(today);

  const list = useQuery({
    queryKey: ["manage", "reports"],
    queryFn: async () => (await apiGet<{ reports: Array<{ date: string; bytes: number }> }>("/api/manage/reports")).reports,
  });
  const report = useQuery({
    queryKey: ["manage", "report", date],
    queryFn: () => apiText(`/api/lhos/report?date=${date}`),
    retry: false,
  });

  const generate = useMutation({
    mutationFn: () => apiPost("/api/manage/reports", { date }),
    onSuccess: () => {
      toast.push({ title: `Report for ${date} generated`, tone: "success" });
      void qc.invalidateQueries({ queryKey: ["manage", "reports"] });
      void qc.invalidateQueries({ queryKey: ["manage", "report", date] });
      void qc.invalidateQueries({ queryKey: ["manage", "audit"] });
    },
    onError: (e) => toast.push({ title: "Could not generate the report", message: e.message, tone: "error" }),
  });

  return (
    <>
      <div className={styles.toolbar}>
        <label className={styles.label}>
          Date (UTC)
          <input type="date" className={styles.input} value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <Button variant="attention" loading={generate.isPending} onClick={() => generate.mutate()}>
          Generate now
        </Button>
      </div>

      {list.isError && <ErrorNote error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && list.data.length > 0 && (
        <div className={styles.tabs} role="group" aria-label="Saved reports">
          {list.data.map((r) => (
            <Button key={r.date} size="sm" variant={r.date === date ? "primary" : "outline"} onClick={() => setDate(r.date)}>
              {r.date}
            </Button>
          ))}
        </div>
      )}
      {list.data && list.data.length === 0 && <p className={styles.empty}>No saved reports yet.</p>}

      {report.isPending && <SkeletonRows rows={6} height={22} />}
      {report.isError && <ErrorNote error={report.error} />}
      {report.data && (
        <div className={styles.report}>
          <Markdown content={report.data} />
        </div>
      )}
    </>
  );
}
