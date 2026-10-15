"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DownloadSimple, File, Folder, LockSimple } from "@phosphor-icons/react/dist/ssr";
import { Button, useToast } from "@/components/ui";
import { formatBytes } from "@/lib/manage/thresholds";
import type { LsEntry } from "@/lib/manage/persist-paths";
import { apiGet, apiPost } from "./api";
import { ErrorNote, SectionHeader, SkeletonRows } from "./shared";
import styles from "./shared.module.css";

export function Persist() {
  const toast = useToast();
  const [dir, setDir] = useState("");

  const query = useQuery({
    queryKey: ["manage", "files", dir],
    queryFn: () => apiGet<{ dir: string; entries: LsEntry[] }>(`/api/manage/files?dir=${encodeURIComponent(dir)}`),
  });

  const download = useMutation({
    mutationFn: async (path: string) => {
      // Open the tab synchronously so the popup blocker treats it as a user gesture.
      const tab = window.open("", "_blank");
      try {
        const { url } = await apiPost<{ url: string }>("/api/manage/files/download", { path });
        if (tab) {
          tab.opener = null;
          tab.location.href = url;
        } else {
          window.location.assign(url);
        }
      } catch (err) {
        tab?.close();
        throw err;
      }
    },
    onError: (e) => toast.push({ title: "Download failed", message: e.message, tone: "error" }),
  });

  const parts = dir ? dir.split("/") : [];
  const join = (name: string) => (dir ? `${dir}/${name}` : name);

  return (
    <>
      <SectionHeader title="Persistent data">
        The agent computer&apos;s <code>~/persist</code>. Downloads use a 1-hour signed link. Secrets and browser state
        are listed but can never be opened or downloaded.
      </SectionHeader>

      <nav className={styles.crumbs} aria-label="Folder path">
        <button type="button" className={styles.crumb} onClick={() => setDir("")}>
          ~/persist
        </button>
        {parts.map((p, i) => (
          <span key={i} className={styles.row} style={{ gap: 2 }}>
            <span aria-hidden>/</span>
            <button type="button" className={styles.crumb} onClick={() => setDir(parts.slice(0, i + 1).join("/"))}>
              {p}
            </button>
          </span>
        ))}
      </nav>

      {query.isError && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}
      {query.isPending && <SkeletonRows rows={6} />}
      {query.data && query.data.entries.length === 0 && <p className={styles.empty}>This folder is empty.</p>}

      {query.data && query.data.entries.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Modified</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {query.data.entries.map((e) => (
                <tr key={e.name}>
                  <td>
                    <span className={styles.cell}>
                      {e.protected ? <LockSimple size={16} /> : e.type === "dir" ? <Folder size={16} /> : <File size={16} />}
                      {e.type === "dir" && !e.protected ? (
                        <button type="button" className={styles.linkBtn} onClick={() => setDir(join(e.name))}>
                          {e.name}
                        </button>
                      ) : (
                        <span>{e.name}</span>
                      )}
                      {e.protected && <span className={styles.protectedTag}>protected</span>}
                    </span>
                  </td>
                  <td className={styles.mono}>{e.type === "dir" ? "—" : formatBytes(e.size)}</td>
                  <td className={styles.mono}>{e.modified}</td>
                  <td>
                    {e.type === "file" && !e.protected && (
                      <Button
                        size="sm"
                        variant="outline"
                        iconLeft={<DownloadSimple size={14} />}
                        disabled={download.isPending}
                        onClick={() => download.mutate(join(e.name))}
                      >
                        Download
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className={styles.meta}>
        Host mirror size and last-sync time are not exposed by the host bridge yet, so they are not shown here.
      </p>
    </>
  );
}
