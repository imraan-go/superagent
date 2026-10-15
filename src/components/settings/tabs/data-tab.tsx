"use client";

import { SettingRow, SettingSection } from "@/components/ui";
import { useSettingsSection } from "@/hooks/use-settings";
import { InlineError, NumberField } from "../controls";
import styles from "../settings-tabs.module.css";

export function DataTab() {
  const data = useSettingsSection("data");

  return (
    <div className={styles.stack}>
      <SettingSection title="Export">
        <SettingRow label="Export chats" description="Every chat and message as one JSON file.">
          {/* A plain link: the browser handles the attachment download. */}
          <a className={styles.chip} href="/api/data/export" download>
            Download JSON
          </a>
        </SettingRow>
        <SettingRow label="Export usage" description="Daily usage for the last 30 days as CSV.">
          <a className={styles.chip} href="/api/usage/export?groupBy=day" download>
            Download CSV
          </a>
        </SettingRow>
      </SettingSection>

      {/* Phase 4: the Memories viewer lands in this tab. */}
      <SettingSection title="Retention">
        <SettingRow
          label="Keep chats for"
          description="Older chats become eligible for clean-up. 0 keeps everything."
        >
          <NumberField
            label="Retention in days"
            value={data.value.retentionDays}
            min={0}
            max={3650}
            suffix="days"
            onCommit={(retentionDays) => void data.save({ retentionDays })}
          />
        </SettingRow>
      </SettingSection>
      <InlineError error={data.error} />
    </div>
  );
}
