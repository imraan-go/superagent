"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Dot } from "@/components/ui";
import { apiGet } from "./api";
import { ErrorNote, SectionHeader, SkeletonRows } from "./shared";
import styles from "./shared.module.css";

interface ActivityEvent {
  ts: number;
  tool: string;
  ok: boolean;
  err: string | null;
  label: string;
  taskId: string;
  chatId: string | null;
  run: string;
}

/** Workspaces → Activity: every tool call across your runs, newest first. */
export function Activity() {
  const query = useQuery({
    queryKey: ["manage", "activity"],
    queryFn: async () => (await apiGet<{ events: ActivityEvent[] }>("/api/activity?limit=200")).events,
    refetchInterval: 10_000,
  });

  return (
    <div className={styles.stack}>
      <SectionHeader title="Activity">What the agent did, across all chats and routines.</SectionHeader>
      {query.isError && !query.data && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}
      {!query.data && !query.isError && <SkeletonRows rows={8} />}
      {query.data && query.data.length === 0 && <p className={styles.empty}>No tool calls yet.</p>}
      {query.data && query.data.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Tool</th>
                <th scope="col">Result</th>
                <th scope="col">Run</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((e, i) => (
                <tr key={`${e.taskId}:${e.ts}:${i}`}>
                  <td className={styles.nowrap}>{new Date(e.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                  <td className={styles.mono}>{e.tool}</td>
                  <td className={styles.wrapCell}>
                    <Dot status={e.ok ? "ok" : "error"} size="sm" /> {e.ok ? e.label || "ok" : e.err}
                  </td>
                  <td className={styles.wrapCell}>{e.chatId ? <Link href={`/chat/${e.chatId}`}>{e.run}</Link> : e.run}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
