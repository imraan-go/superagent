"use client";

import { useQuery } from "@tanstack/react-query";
import { SettingRow, SettingSection } from "@/components/ui";
import { settingsFetch } from "@/hooks/use-settings";
import { cn } from "@/lib/cn";
import styles from "../settings-tabs.module.css";

interface RetentionView {
  retention: { taskDays: number; operationalLogDays: number; approvalExpiryHours: number };
}

export function DataTab() {
  const s = useQuery({ queryKey: ["settings", "budget"], queryFn: () => settingsFetch<RetentionView>("/api/settings") });
  const r = s.data?.retention;

  return (
    <div className={styles.stack}>
      <SettingSection title="Export">
        <SettingRow label="Export everything" description="Chats' runs, events, memories, routines, connections and file metadata as one JSON file.">
          {/* A plain link: the browser handles the attachment download. */}
          <a className={styles.chip} href="/api/export" download>
            Download JSON
          </a>
        </SettingRow>
        <SettingRow label="Export usage" description="This month's usage entries as CSV.">
          <a className={styles.chip} href="/api/usage/export" download>
            Download CSV
          </a>
        </SettingRow>
      </SettingSection>

      <SettingSection title="Retention">
        <p className={cn(styles.muted, styles.pad)}>Set by the server. Expired data is removed by a daily routine.</p>
        <SettingRow label="Runs and their files" description="Messages, events and files produced by a run.">
          <span className={styles.mono}>{r ? `${r.taskDays} days` : "—"}</span>
        </SettingRow>
        <SettingRow label="Operational logs" description="Internal delivery records.">
          <span className={styles.mono}>{r ? `${r.operationalLogDays} days` : "—"}</span>
        </SettingRow>
        <SettingRow label="Questions and approvals wait" description="After this, a waiting run continues without your answer.">
          <span className={styles.mono}>{r ? `${r.approvalExpiryHours} hours` : "—"}</span>
        </SettingRow>
      </SettingSection>
    </div>
  );
}
