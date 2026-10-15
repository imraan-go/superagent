"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Dot } from "@/components/ui";
import { apiGet } from "./api";
import type { HitlItem } from "./api";
import { ErrorNote, SectionHeader, SkeletonRows } from "./shared";
import styles from "./shared.module.css";

export function Hitl() {
  const query = useQuery({
    queryKey: ["manage", "hitl"],
    queryFn: async () => (await apiGet<{ pending: HitlItem[] }>("/api/manage/hitl")).pending,
    refetchInterval: 10_000,
  });

  return (
    <>
      <SectionHeader title="HITL inbox">
        Requests the agent computer is waiting on a human for. Read-only here; answer them in the{" "}
        <Link href="/">Agent view</Link>.
      </SectionHeader>
      {query.isError && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}
      {query.isPending && <SkeletonRows rows={3} height={44} />}
      {query.data && query.data.length === 0 && <p className={styles.empty}>Nothing is waiting on you.</p>}
      {query.data && query.data.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Id</th>
                <th>Kind</th>
                <th>Request</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((h) => (
                <tr key={h.id}>
                  <td className={styles.mono}>{h.id}</td>
                  <td>
                    <span className={styles.cell}>
                      <Dot status="warn" size="sm" />
                      {h.kind ?? "—"}
                    </span>
                  </td>
                  <td className={styles.wrapCell}>{h.prompt ?? "—"}</td>
                  <td className={`${styles.mono} ${styles.nowrap}`}>{h.created ? ago(h.created) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ago(epochSeconds: number): string {
  const s = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
