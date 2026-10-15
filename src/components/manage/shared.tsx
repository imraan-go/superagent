"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button, Dot, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { sparkPoints } from "@/lib/manage/sparkline";
import type { Sample } from "@/lib/manage/sparkline";
import { apiGet, ManageApiError } from "./api";
import type { Job } from "./api";
import styles from "./shared.module.css";

export function SectionHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className={styles.heading}>
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}

/** Clear, specific failure state. Bridge outages say so rather than showing a generic error. */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const err = error instanceof ManageApiError ? error : null;
  let headline = "Something went wrong.";
  let detail = err?.message ?? (error instanceof Error ? error.message : "");
  if (err?.code === "bridge_unavailable") {
    headline = "Host bridge unreachable";
    detail = "The panel could not reach the host bridge on this machine. Check that the host-bridge service is running.";
  } else if (err?.code === "lhos_unavailable") {
    headline = "Agent server unreachable";
    detail = "The LHOS agent server did not respond.";
  } else if (err?.code === "computer_waking") {
    headline = "The agent computer is waking up";
    detail = "Try again in about 30 seconds.";
  } else if (err?.code === "network") {
    headline = "Panel server unreachable";
  }
  return (
    <div className={styles.errorNote} role="alert">
      <Dot status="error" size="sm" />
      <div>
        <strong>{headline}</strong>
        {detail && <span>{detail}</span>}
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function SkeletonRows({ rows = 4, height = 36 }: { rows?: number; height?: number }) {
  return (
    <div className={styles.skeletonRows} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </div>
  );
}

/** Inline sparkline; the y-scale is pinned when `max` is given. */
export function Sparkline({
  series,
  max,
  label,
  tone = "default",
}: {
  series: readonly Sample[];
  max?: number;
  label: string;
  tone?: "default" | "amber" | "danger";
}) {
  const W = 120;
  const H = 28;
  const points = sparkPoints(series, W, H, max === undefined ? {} : { max });
  return (
    <svg
      className={cn(styles.spark, tone === "amber" && styles.sparkAmber, tone === "danger" && styles.sparkDanger)}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${label}, last 30 minutes`}
      preserveAspectRatio="none"
    >
      <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className={styles.sparkBase} />
      {series.length > 1 && <polyline points={points} fill="none" />}
    </svg>
  );
}

const settledJobs = new Set<string>();

/**
 * Polls a bridge job until it ends. `onDone` fires exactly once per job, from
 * the fetch itself, so callers need no effect to react to completion.
 */
export function useJob(jobId: string | null, onDone?: (job: Job) => void) {
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  return useQuery({
    queryKey: ["manage", "job", jobId],
    queryFn: async () => {
      const { job } = await apiGet<{ job: Job }>(`/api/manage/jobs/${jobId}`);
      if (job.ended !== null && !settledJobs.has(job.id)) {
        settledJobs.add(job.id);
        doneRef.current?.(job);
      }
      return job;
    },
    enabled: jobId !== null,
    refetchInterval: (q) => (q.state.data && q.state.data.ended !== null ? false : 1500),
    retry: 3,
  });
}

export function JobProgress({ job, label }: { job: Job | undefined; label: string }) {
  if (!job) {
    return (
      <p className={styles.jobLine} role="status">
        <Dot status="pending" size="sm" pulse /> {label} starting…
      </p>
    );
  }
  const running = job.ended === null;
  return (
    <div className={styles.job} role="status" aria-live="polite">
      <p className={styles.jobLine}>
        <Dot status={running ? "warn" : job.ok ? "ok" : "error"} size="sm" pulse={running} />
        {label}: {running ? "running" : job.ok ? "done" : "failed"}
      </p>
      {job.output && <pre className={styles.jobOutput}>{job.output.slice(-1500)}</pre>}
    </div>
  );
}

export function formatWhen(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatAgeMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
  return `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`;
}
