"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/ssr";
import { Button, Dot, HoldToConfirm, Panel, useToast } from "@/components/ui";
import { apiGet, apiPost } from "./api";
import type { AuditEntry, ConfigRow, Job } from "./api";
import { ErrorNote, JobProgress, SectionHeader, SkeletonRows, useJob } from "./shared";
import styles from "./shared.module.css";

export function System() {
  return (
    <>
      <SectionHeader title="System">
        Host configuration (read-only, secrets masked), token rotation, and the audit trail of everything done here.
      </SectionHeader>
      <div className={styles.stack}>
        <ConfigViewer />
        <Rotation />
        <PanelOps />
        <AuditLog />
      </div>
    </>
  );
}

function ConfigViewer() {
  const [filter, setFilter] = useState("");
  const query = useQuery({
    queryKey: ["manage", "config"],
    queryFn: async () => (await apiGet<{ config: ConfigRow[] }>("/api/manage/config")).config,
  });
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (query.data ?? []).filter((r) => !q || r.key.toLowerCase().includes(q));
  }, [query.data, filter]);

  return (
    <Panel
      title="Host config"
      actions={
        <input
          className={styles.input}
          placeholder="Filter keys"
          aria-label="Filter config keys"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      }
    >
      <p className={styles.meta} style={{ marginTop: 0 }}>
        Read-only. Secret values never leave the host: only the key and value length are shown. To change a value, edit{" "}
        <code>config.env</code> on the host and restart the affected unit.
      </p>
      {query.isError && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}
      {query.isPending && <SkeletonRows rows={5} height={26} />}
      {query.data && (
        <div className={styles.tableWrap} style={{ marginTop: "var(--sp-3)" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className={styles.mono}>{r.key}</td>
                  <td className={`${styles.mono} ${styles.wrapCell}`}>
                    {r.secret || r.value === null ? `masked · ${r.length} chars` : r.value || "(empty)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Rotation() {
  const toast = useToast();
  const qc = useQueryClient();
  const [phrase, setPhrase] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

  const job = useJob(jobId, (j) => {
    toast.push({ title: j.ok ? "Tokens rotated" : "Rotation failed", tone: j.ok ? "success" : "error", durationMs: 0 });
    void qc.invalidateQueries({ queryKey: ["manage", "audit"] });
  });
  const running = jobId !== null && !(job.data && job.data.ended !== null);

  const start = useMutation({
    mutationFn: () => apiPost<{ job: Job }>("/api/manage/rotate-auth", { confirm: phrase }),
    onSuccess: ({ job: j }) => {
      setJobId(j.id);
      setPhrase("");
    },
    onError: (e) => toast.push({ title: "Could not start rotation", message: e.message, tone: "error" }),
  });

  return (
    <Panel title="Token rotation" tone="attention">
      <p className={styles.meta} style={{ marginTop: 0 }}>
        Rotates the agent computer&apos;s access tokens through the host bridge. Every client holding the old tokens
        stops working until it has the new ones.
      </p>
      <div className={styles.confirmBox}>
        <strong>After rotation finishes:</strong>
        <span>
          the host bridge syncs the new tokens and restarts the panel service, so this page reconnects by itself after
          about 10 seconds. Requests made during the restart may fail briefly.
        </span>
        <label className={styles.label}>
          Type ROTATE to enable
          <input
            className={`${styles.input} ${styles.monoInput}`}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={running}
          />
        </label>
        <div>
          <HoldToConfirm
            tone="danger"
            icon={<ArrowsClockwise size={14} />}
            disabled={phrase !== "ROTATE" || start.isPending || running}
            onConfirm={() => start.mutate()}
          >
            Rotate tokens
          </HoldToConfirm>
        </div>
      </div>
      {jobId && <JobProgress job={job.data} label="Token rotation" />}
    </Panel>
  );
}

function PanelOps() {
  return (
    <Panel title="Panel operations">
      <p className={styles.meta} style={{ marginTop: 0 }}>
        Database backup-now is not offered: it needs host-level access (pg_dump on the host) that the host bridge does not
        expose. The nightly dump is scheduled with the deployment instead. Restart the panel itself from the host.
      </p>
    </Panel>
  );
}

function AuditLog() {
  const query = useQuery({
    queryKey: ["manage", "audit"],
    queryFn: async () => (await apiGet<{ entries: AuditEntry[] }>("/api/manage/audit?limit=100")).entries,
    refetchInterval: 30_000,
  });

  return (
    <Panel title="Audit log" actions={<Button size="sm" variant="ghost" onClick={() => void query.refetch()}>Refresh</Button>}>
      {query.isError && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}
      {query.isPending && <SkeletonRows rows={4} height={26} />}
      {query.data && query.data.length === 0 && <p className={styles.empty}>Nothing recorded yet.</p>}
      {query.data && query.data.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Detail</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((a) => (
                <tr key={a.id}>
                  <td className={`${styles.mono} ${styles.nowrap}`}>{new Date(a.ts).toLocaleString()}</td>
                  <td className={styles.nowrap}>{a.action}</td>
                  <td className={`${styles.mono} ${styles.wrapCell}`}>{a.detail ? JSON.stringify(a.detail) : "—"}</td>
                  <td className={styles.wrapCell}>
                    <span className={styles.cell}>
                      <Dot status={a.ok ? "ok" : "error"} size="sm" />
                      {a.ok ? "ok" : "failed"}
                    </span>
                    {a.result && !a.ok && <div className={styles.mono}>{a.result.slice(0, 160)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
