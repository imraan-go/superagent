"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LockKey } from "@phosphor-icons/react/dist/ssr";
import { Button, Dot, HoldToConfirm, Panel, Readout, useToast } from "@/components/ui";
import { usageTone } from "@/lib/manage/thresholds";
import { BADGE_LABEL, badgeFor } from "@/lib/manage/snapshot-cleanup";
import type { BuildBadge, CleanupPlan } from "@/lib/manage/snapshot-cleanup";
import { apiGet, apiPost } from "./api";
import { CleanupPanel } from "./snapshot-cleanup";
import { ErrorNote, formatAgeMinutes, SectionHeader, SkeletonRows } from "./shared";
import styles from "./shared.module.css";

const BADGE_DOT: Record<BuildBadge, "ok" | "warn" | "idle" | "pending"> = {
  "kept-root": "ok",
  "kept-ancestor": "idle",
  deletable: "warn",
  "in-flight": "pending",
};

/* ---------------------------------------------------------- snapshots -- */

interface SnapshotList {
  count: number;
  total_mb: number;
  keep?: number;
  db_ok?: boolean;
  snapshots: Array<{ build: string; size_mb: number; age_min: number; protected: boolean }>;
}

export function Snapshots() {
  const query = useQuery({
    queryKey: ["manage", "snapshots"],
    queryFn: () => apiGet<SnapshotList>("/api/manage/snapshots"),
  });
  const d = query.data;
  const [plan, setPlan] = useState<CleanupPlan | undefined>();

  return (
    <>
      <SectionHeader title="Snapshots">
        Desktop snapshot builds on the host disk. Cleanup is planned by the host bridge and is always reversible until you
        delete the quarantine.
      </SectionHeader>

      <CleanupPanel onPlan={setPlan} />
      <div style={{ height: "var(--sp-4)" }} />
      {query.isError && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}
      {query.isPending && <SkeletonRows rows={6} height={30} />}
      {d && (
        <>
          <div className={styles.readouts} style={{ marginBottom: "var(--sp-4)" }}>
            <Readout label="builds" value={d.count} size="sm" />
            <Readout label="total" value={Math.round(d.total_mb / 1024)} unit="GB" size="sm" />
            <Readout label="keep newest" value={d.keep ?? 0} size="sm" />
            <Readout label="db" value={d.db_ok === false ? "mismatch" : "ok"} size="sm" tone={d.db_ok === false ? "danger" : "ok"} />
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Build</th>
                  <th>Size</th>
                  <th>Age</th>
                  <th>Protected</th>
                  <th>Cleanup</th>
                </tr>
              </thead>
              <tbody>
                {d.snapshots.map((s) => (
                  <tr key={s.build}>
                    <td className={styles.mono}>{s.build}</td>
                    <td className={styles.mono}>{(s.size_mb / 1024).toFixed(2)} GB</td>
                    <td className={styles.mono}>{formatAgeMinutes(s.age_min)}</td>
                    <td>
                      <span className={styles.cell}>
                        <Dot status={s.protected ? "ok" : "idle"} size="sm" />
                        {s.protected ? "yes" : "no"}
                      </span>
                    </td>
                    <td>
                      {(() => {
                        const badge = badgeFor(s.build, s.age_min, plan);
                        return badge ? (
                          <span className={styles.cell}>
                            <Dot status={BADGE_DOT[badge]} size="sm" />
                            {BADGE_LABEL[badge]}
                          </span>
                        ) : (
                          <span className={styles.meta} style={{ margin: 0 }}>
                            run Preview
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------- schedules -- */

interface Schedule {
  name: string;
  cron?: string;
  enabled: boolean;
  next_run_utc?: string | null;
  last_status?: string | null;
  locked: boolean;
}

interface MaintenanceStatus {
  disk?: { total_gb: number; used_gb: number; free_gb: number; used_pct: number };
  snapshots?: { count: number; total_mb: number; keep?: number };
  runnable: string[];
}

export function Schedules() {
  const toast = useToast();
  const qc = useQueryClient();

  const schedules = useQuery({
    queryKey: ["manage", "schedules"],
    queryFn: async () => (await apiGet<{ schedules: Schedule[] }>("/api/manage/schedules")).schedules,
  });
  const maintenance = useQuery({
    queryKey: ["manage", "maintenance"],
    queryFn: () => apiGet<MaintenanceStatus>("/api/manage/maintenance"),
  });

  const act = useMutation({
    mutationFn: (v: { name: string; action: "enable" | "disable" | "run" }) =>
      apiPost(`/api/manage/schedules/${encodeURIComponent(v.name)}`, { action: v.action }),
    onSuccess: (_d, v) => {
      toast.push({ title: `${v.name}: ${v.action === "run" ? "started" : v.action + "d"}`, tone: "success" });
      void qc.invalidateQueries({ queryKey: ["manage", "schedules"] });
      void qc.invalidateQueries({ queryKey: ["manage", "audit"] });
    },
    onError: (e) => toast.push({ title: "Schedule action failed", message: e.message, tone: "error" }),
  });

  const prune = useMutation({
    mutationFn: (dryRun: boolean) => apiPost<{ output: string }>("/api/manage/maintenance", { task: "fs_prune", dryRun }),
    onSuccess: (r, dryRun) => {
      toast.push({ title: dryRun ? "fs-prune dry run" : "fs-prune ran", message: r.output.slice(0, 300), tone: "success", durationMs: 8000 });
      void qc.invalidateQueries({ queryKey: ["manage", "maintenance"] });
      void qc.invalidateQueries({ queryKey: ["manage", "audit"] });
    },
    onError: (e) => toast.push({ title: "fs-prune failed", message: e.message, tone: "error" }),
  });

  const disk = maintenance.data?.disk;

  return (
    <>
      <SectionHeader title="Schedules & maintenance">
        Scheduled jobs on the agent server. The snapshot-prune job is locked and cannot be enabled or run from here.
      </SectionHeader>

      {schedules.isError && <ErrorNote error={schedules.error} onRetry={() => void schedules.refetch()} />}
      {schedules.isPending && <SkeletonRows rows={3} />}
      {schedules.data && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Job</th>
                <th>Cron (UTC)</th>
                <th>Next run</th>
                <th>Last</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schedules.data.map((s) => (
                <tr key={s.name}>
                  <td>
                    <span className={styles.cell}>
                      {s.locked && <LockKey size={14} aria-label="locked" />}
                      {s.name}
                    </span>
                  </td>
                  <td className={styles.mono}>{s.cron ?? "—"}</td>
                  <td className={styles.mono}>{s.next_run_utc ?? "—"}</td>
                  <td className={styles.mono}>{s.last_status || "—"}</td>
                  <td>
                    <span className={styles.cell}>
                      <Dot status={s.enabled ? "ok" : "idle"} size="sm" />
                      {s.locked ? "locked off" : s.enabled ? "enabled" : "disabled"}
                    </span>
                  </td>
                  <td>
                    <div className={styles.row}>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={s.locked || act.isPending}
                        onClick={() => act.mutate({ name: s.name, action: s.enabled ? "disable" : "enable" })}
                      >
                        {s.enabled ? "Disable" : "Enable"}
                      </Button>
                      <HoldToConfirm
                        size="sm"
                        disabled={s.locked || act.isPending}
                        onConfirm={() => act.mutate({ name: s.name, action: "run" })}
                      >
                        Run now
                      </HoldToConfirm>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className={styles.sectionTitle}>Maintenance</h2>
      {maintenance.isError && <ErrorNote error={maintenance.error} onRetry={() => void maintenance.refetch()} />}
      {maintenance.isPending && <SkeletonRows rows={2} />}
      {maintenance.data && (
        <Panel title="Host disk and fs-prune">
          <div className={styles.readouts}>
            {disk && (
              <>
                <Readout label="disk used" value={disk.used_pct} unit="%" precision={1} size="sm" tone={usageTone(disk.used_pct)} />
                <Readout label="free" value={disk.free_gb} unit="GB" precision={1} size="sm" />
                <Readout label="total" value={disk.total_gb} unit="GB" precision={1} size="sm" />
              </>
            )}
            {maintenance.data.snapshots && (
              <Readout label="snapshots" value={Math.round(maintenance.data.snapshots.total_mb / 1024)} unit="GB" size="sm" />
            )}
          </div>
          <div className={styles.row} style={{ marginTop: "var(--sp-4)" }}>
            <Button size="sm" variant="outline" loading={prune.isPending} onClick={() => prune.mutate(true)}>
              fs-prune dry run
            </Button>
            <HoldToConfirm size="sm" disabled={prune.isPending} onConfirm={() => prune.mutate(false)}>
              Run fs-prune
            </HoldToConfirm>
            <span className={styles.meta} style={{ margin: 0 }}>
              snapshot-prune: locked
            </span>
          </div>
        </Panel>
      )}
    </>
  );
}
