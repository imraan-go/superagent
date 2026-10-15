"use client";

import { useState } from "react";
import { Button, SettingRow, SettingSection } from "@/components/ui";
import { useSettingsSection } from "@/hooks/use-settings";
import { DEFAULT_CHECKPOINT_PATTERNS } from "@/lib/settings";
import { InlineError, Toggle } from "../controls";
import styles from "../settings-tabs.module.css";

const LOCKED = new Set<string>(DEFAULT_CHECKPOINT_PATTERNS);

export function ApprovalsTab() {
  const approvals = useSettingsSection("approvals");
  const v = approvals.value;
  const [draft, setDraft] = useState("");

  const extra = v.checkpointPatterns.filter((p) => !LOCKED.has(p.toLowerCase()));

  const add = () => {
    const pattern = draft.trim();
    if (!pattern) return;
    void approvals.save({ checkpointPatterns: [...v.checkpointPatterns, pattern] });
    setDraft("");
  };

  return (
    <div className={styles.stack}>
      <SettingSection title="Checkpoints">
        <SettingRow
          label="Always pause before"
          description="Built in. These can never be removed — irreversible actions always come to you."
        >
          <span className={styles.chips}>
            {DEFAULT_CHECKPOINT_PATTERNS.map((p) => (
              <span key={p} className={`${styles.chip} ${styles.chipLocked}`}>
                {p}
              </span>
            ))}
          </span>
        </SettingRow>
        <SettingRow
          label="Also pause before"
          description="A verb (matched as a whole word in the tool name, e.g. archive) or a regular expression."
        >
          <span className={styles.chips}>
            {extra.length === 0 && <span className={styles.muted}>None added</span>}
            {extra.map((p) => (
              <span key={p} className={styles.chip}>
                {p}
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={`Remove ${p}`}
                  onClick={() =>
                    void approvals.save({
                      checkpointPatterns: v.checkpointPatterns.filter((x) => x !== p),
                    })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </span>
        </SettingRow>
        <SettingRow label="Add a checkpoint" description="Stricter only — nothing here can skip an approval.">
          <form
            className={styles.row}
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input
              aria-label="New checkpoint pattern"
              className={styles.input}
              maxLength={200}
              placeholder="archive"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button size="sm" type="submit" disabled={!draft.trim()}>
              Add
            </Button>
          </form>
        </SettingRow>
      </SettingSection>

      <SettingSection title="Takeover">
        <SettingRow
          label="Chrome notification on approval"
          description="Ping the browser when a run is waiting on you."
        >
          <Toggle
            label="Chrome notification on approval"
            checked={v.notifyChrome}
            onChange={(notifyChrome) => void approvals.save({ notifyChrome })}
          />
        </SettingRow>
        <SettingRow
          label="Expand the computer on takeover"
          description="Open the live desktop full-size when the agent hands control to you."
        >
          <Toggle
            label="Expand the computer on takeover"
            checked={v.autoExpandComputerOnTakeover}
            onChange={(autoExpandComputerOnTakeover) =>
              void approvals.save({ autoExpandComputerOnTakeover })
            }
          />
        </SettingRow>
      </SettingSection>
      <InlineError error={approvals.error} />
    </div>
  );
}
