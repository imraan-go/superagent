"use client";

import { useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowsClockwise, Moon, Power, Sun } from "@phosphor-icons/react/dist/ssr";
import { Button, Dot, HoldToConfirm, Modal, Panel, Readout, Skeleton, useToast } from "@/components/ui";
import type { DotStatus } from "@/components/ui";
import { formatBytes, formatUptime, percentOf, usageTone } from "@/lib/manage/thresholds";
import { apiGet, apiPost } from "./api";
import type { Desktop, Job, ServiceRow, Stats } from "./api";
import { ErrorNote, JobProgress, SectionHeader, SkeletonRows, Sparkline, useJob } from "./shared";
import {
  getServerStatsHistory,
  getStatsHistory,
  recordStats,
  subscribeStats,
} from "./stats-store";
import styles from "./shared.module.css";

export function Overview() {
  return (
    <>
      <SectionHeader title="Overview">
        Services, the agent desktop and host resources, straight from the host bridge. Actions need a press-and-hold.
      </SectionHeader>
      <HostStats />
      <h2 className={styles.sectionTitle}>Desktop</h2>
      <DesktopCard />
      <h2 className={styles.sectionTitle}>Services</h2>
      <Services />
    </>
  );
}

/* ------------------------------------------------------------- stats -- */

function HostStats() {
  const query = useQuery({
    queryKey: ["manage", "stats"],
    queryFn: async () => {
      const { stats } = await apiGet<{ stats: Stats }>("/api/manage/stats");
      recordStats(stats);
      return stats;
    },
    refetchInterval: 5_000,
  });
  const history = useSyncExternalStore(subscribeStats, getStatsHistory, getServerStatsHistory);
  const s = query.data;

  if (query.isError && !s) return <ErrorNote error={query.error} onRetry={() => void query.refetch()} />;
  if (!s) {
    return (
      <div className={styles.grid}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} shape="panel" height={120} />
        ))}
      </div>
    );
  }

  const cpu = s.cpuPercent ?? 0;
  const ram = percentOf(s.memTotal - s.memAvailable, s.memTotal);
  const swap = percentOf(s.swapTotal - s.swapFree, s.swapTotal);
  const disk = s.diskUsedPercent;

  const items = [
    { key: "cpu", label: "CPU", value: cpu, series: history.cpu, extra: `${s.cpuCount ?? "?"} cores` },
    {
      key: "ram",
      label: "RAM",
      value: ram,
      series: history.ram,
      extra: `${formatBytes(s.memTotal - s.memAvailable)} / ${formatBytes(s.memTotal)}`,
    },
    {
      key: "swap",
      label: "Swap",
      value: swap,
      series: history.swap,
      extra: s.swapTotal ? `${formatBytes(s.swapTotal - s.swapFree)} / ${formatBytes(s.swapTotal)}` : "none",
    },
    {
      key: "disk",
      label: "Disk /",
      value: disk,
      series: history.disk,
      extra: `${formatBytes(s.diskFree)} free`,
    },
  ] as const;

  return (
    <>
      {query.isError && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}
      <div className={styles.grid}>
        {items.map((it) => {
          const tone = usageTone(it.value);
          return (
            <Panel
              key={it.key}
              title={it.label}
              tone={tone === "danger" ? "critical" : tone === "amber" ? "attention" : "default"}
            >
              <Readout label="used" value={Math.round(it.value * 10) / 10} unit="%" precision={1} size="lg" tone={tone} />
              <p className={styles.meta}>{it.extra}</p>
              <Sparkline series={it.series} max={100} label={`${it.label} usage`} tone={tone} />
            </Panel>
          );
        })}
      </div>
      <div className={styles.readouts} style={{ marginTop: "var(--sp-4)" }}>
        <Readout label="load 1m" value={s.load[0] ?? 0} precision={2} size="sm" inline />
        <Readout label="5m" value={s.load[1] ?? 0} precision={2} size="sm" inline />
        <Readout label="15m" value={s.load[2] ?? 0} precision={2} size="sm" inline />
        <Readout label="uptime" value={formatUptime(s.uptimeSeconds)} size="sm" inline />
      </div>
    </>
  );
}

/* ---------------------------------------------------------- services -- */

function serviceStatus(s: ServiceRow): DotStatus {
  if (s.active === "active") return s.sub === "running" || s.sub === "exited" ? "ok" : "warn";
  if (s.active === "failed") return "error";
  if (s.active === "activating" || s.active === "reloading") return "warn";
  return "idle";
}

function Services() {
  const query = useQuery({
    queryKey: ["manage", "services"],
    queryFn: async () => (await apiGet<{ services: ServiceRow[] }>("/api/manage/services")).services,
    refetchInterval: 10_000,
  });

  if (query.isError && !query.data) return <ErrorNote error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) {
    return (
      <div className={styles.grid}>
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} shape="panel" height={132} />
        ))}
      </div>
    );
  }
  return (
    <div className={styles.grid}>
      {query.data.map((svc) => (
        <ServiceCard key={svc.unit} svc={svc} />
      ))}
    </div>
  );
}

function ServiceCard({ svc }: { svc: ServiceRow }) {
  const toast = useToast();
  const qc = useQueryClient();
  const isCaddy = svc.unit === "caddy";
  const verb = isCaddy ? "Reload" : "Restart";

  const restart = useMutation({
    mutationFn: () => apiPost(`/api/manage/services/${svc.unit}/restart`),
    onSuccess: () => {
      toast.push({ title: `${svc.unit} ${isCaddy ? "reloaded" : "restarted"}`, tone: "success" });
      void qc.invalidateQueries({ queryKey: ["manage", "services"] });
      void qc.invalidateQueries({ queryKey: ["manage", "audit"] });
    },
    onError: (e) => toast.push({ title: `${verb} failed`, message: e.message, tone: "error" }),
  });

  return (
    <Panel
      title={<span className={styles.svcName}>{svc.unit}</span>}
      badge={<Dot status={serviceStatus(svc)} pulse={svc.active === "active" && svc.sub === "running"} label={svc.active ?? "unknown"} />}
    >
      <dl className={styles.svcFacts}>
        <dt>state</dt>
        <dd>
          {svc.active ?? "—"}
          {svc.sub ? ` (${svc.sub})` : ""}
        </dd>
        <dt>since</dt>
        <dd>{svc.since ?? "—"}</dd>
        <dt>memory</dt>
        <dd>{formatBytes(svc.memoryBytes)}</dd>
      </dl>
      <HoldToConfirm
        size="sm"
        tone="attention"
        disabled={restart.isPending}
        icon={<ArrowsClockwise size={14} />}
        label={`${verb} ${svc.unit} (hold to confirm)`}
        onConfirm={() => restart.mutate()}
      >
        {restart.isPending ? `${verb}ing…` : verb}
      </HoldToConfirm>
    </Panel>
  );
}

/* ----------------------------------------------------------- desktop -- */

type Verb = "sleep" | "wake" | "new";

function DesktopCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [verb, setVerb] = useState<Verb | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [phrase, setPhrase] = useState("");

  const desktop = useQuery({
    queryKey: ["manage", "desktop"],
    queryFn: async () => (await apiGet<{ desktop: Desktop }>("/api/manage/desktop")).desktop,
    refetchInterval: 10_000,
  });
  const job = useJob(jobId, (j) => {
    toast.push({
      title: j.ok ? `Desktop ${j.action} finished` : `Desktop ${j.action} failed`,
      tone: j.ok ? "success" : "error",
    });
    void qc.invalidateQueries({ queryKey: ["manage", "desktop"] });
    void qc.invalidateQueries({ queryKey: ["manage", "audit"] });
  });
  const finished = job.data && job.data.ended !== null ? job.data : null;
  const busy = jobId !== null && !finished;

  const start = useMutation({
    mutationFn: (args: { verb: Verb; confirm?: string }) =>
      apiPost<{ job: Job }>(`/api/manage/desktop/${args.verb}`, args.confirm ? { confirm: args.confirm } : {}),
    onSuccess: ({ job: j }, args) => {
      setVerb(args.verb);
      setJobId(j.id);
      setNewOpen(false);
      setPhrase("");
    },
    onError: (e) => toast.push({ title: "Could not start the desktop action", message: e.message, tone: "error" }),
  });

  const d = desktop.data;
  const up = d?.service === "active";

  return (
    <Panel
      title="Agent desktop"
      badge={<Dot status={desktop.isPending ? "pending" : up ? "live" : "warn"} pulse={up} label={d?.service ?? "unknown"} />}
    >
      {desktop.isError && !d ? (
        <ErrorNote error={desktop.error} onRetry={() => void desktop.refetch()} />
      ) : !d ? (
        <SkeletonRows rows={2} height={20} />
      ) : (
        <div className={styles.readouts}>
          <Readout label="sandbox" value={d.sandbox_id ?? "—"} size="sm" />
          <Readout label="mode" value={d.mode ?? "—"} size="sm" />
          <Readout label="service" value={d.service ?? "—"} size="sm" tone={up ? "ok" : "amber"} />
        </div>
      )}

      <div className={styles.row} style={{ marginTop: "var(--sp-4)" }}>
        <HoldToConfirm size="sm" icon={<Moon size={14} />} disabled={busy || start.isPending} onConfirm={() => start.mutate({ verb: "sleep" })}>
          Sleep
        </HoldToConfirm>
        <HoldToConfirm size="sm" icon={<Sun size={14} />} disabled={busy || start.isPending} onConfirm={() => start.mutate({ verb: "wake" })}>
          Wake
        </HoldToConfirm>
        <Button size="sm" variant="danger" iconLeft={<Power size={14} />} disabled={busy || start.isPending} onClick={() => setNewOpen(true)}>
          New desktop…
        </Button>
        {d?.url && (
          <a href={d.url} target="_blank" rel="noreferrer noopener" className={styles.mono}>
            Open VNC
          </a>
        )}
      </div>

      {jobId && <JobProgress job={job.data} label={`Desktop ${verb ?? ""}`} />}

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Create a new desktop"
        description="This discards the current desktop session and builds a fresh one. Anything not saved to ~/persist is lost."
      >
        <div className={styles.stack}>
          <label className={styles.label}>
            Type NEW DESKTOP to continue
            <input
              className={`${styles.input} ${styles.monoInput}`}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className={styles.row}>
            <HoldToConfirm
              tone="danger"
              disabled={phrase !== "NEW DESKTOP" || start.isPending}
              onConfirm={() => start.mutate({ verb: "new", confirm: phrase })}
            >
              Create new desktop
            </HoldToConfirm>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </Panel>
  );
}
