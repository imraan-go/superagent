"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, SegmentedSwitch, SettingRow, SettingSection } from "@/components/ui";
import { settingsFetch, useSettingsSection } from "@/hooks/use-settings";
import { InlineError, NumberField, Select } from "../controls";
import styles from "../settings-tabs.module.css";
import { ToolAllowlistSection } from "./tool-allowlist";
import type { ModelsView } from "./models-tab";
import { MODELS_VIEW_KEY } from "./models-tab";

export function AgentTab() {
  const agent = useSettingsSection("agent");
  const v = agent.value;
  const models = useQuery({
    queryKey: MODELS_VIEW_KEY,
    queryFn: () => settingsFetch<ModelsView>("/api/settings/models"),
  });
  const [paceWarning, setPaceWarning] = useState<string | null>(null);

  return (
    <div className={styles.stack}>
      <SettingSection title="Behaviour">
        <SettingRow
          label="Default model"
          description="Also editable in Models. Chats keep the model they were started with."
        >
          <Select
            label="Default model"
            value={v.defaultModel ?? models.data?.catalogDefault ?? ""}
            options={(models.data?.models ?? []).map((m) => ({
              value: m.id,
              label: `${m.label}${m.enabled ? "" : " (disabled)"}`,
            }))}
            onChange={(defaultModel) => void agent.save({ defaultModel })}
          />
        </SettingRow>
        <SettingRow label="Max steps per run" description="The loop stops after this many model turns.">
          <NumberField
            label="Max steps per run"
            value={v.maxSteps}
            min={1}
            max={200}
            onCommit={(maxSteps) => void agent.save({ maxSteps })}
          />
        </SettingRow>
        <SettingRow label="Max cost per run" description="A run that spends past this is stopped.">
          <NumberField
            label="Max cost per run in USD"
            prefix="$"
            value={v.maxCostUsdPerRun}
            min={0}
            max={1000}
            step={0.5}
            onCommit={(maxCostUsdPerRun) => void agent.save({ maxCostUsdPerRun })}
          />
        </SettingRow>
        <SettingRow
          label="Pace"
          description={
            <>
              Rate limit on the agent computer: fast = 4 s gap / 60 per hour, careful = 12 s / 20 per hour.
              {paceWarning && <span className={styles.error}> {paceWarning}</span>}
            </>
          }
        >
          <SegmentedSwitch
            label="Pace"
            size="sm"
            value={v.pace}
            options={[
              { value: "fast", label: "Fast" },
              { value: "careful", label: "Careful" },
            ]}
            onChange={async (pace) => {
              setPaceWarning(null);
              const response = await fetch("/api/settings/agent", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ pace }),
              });
              if (response.headers.get("x-pace-applied") === "0") {
                setPaceWarning("Saved, but the agent computer did not confirm — it applies when it is reachable.");
              }
              void agent.refetch();
            }}
          />
        </SettingRow>
        <SettingRow
          label="Memory recall"
          description="How many memories are recalled into each run (0 turns recall off)."
        >
          <NumberField
            label="Memory recall top K"
            value={v.memoryRecallTopK}
            min={0}
            max={32}
            onCommit={(memoryRecallTopK) => void agent.save({ memoryRecallTopK })}
          />
        </SettingRow>
      </SettingSection>

      <SystemPromptSection value={v.systemPrompt} onSave={(systemPrompt) => agent.save({ systemPrompt })} />

      <ToolAllowlistSection
        value={v.toolAllowlist}
        onSave={(toolAllowlist) => agent.save({ toolAllowlist })}
        onSaved={() => agent.refetch()}
      />
      <InlineError error={agent.error} />
    </div>
  );
}

function SystemPromptSection({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }

  return (
    <SettingSection title="System prompt">
      <div style={{ padding: "var(--sp-4)" }}>
        <p className={styles.muted} style={{ marginTop: 0 }}>
          Added on top of the built-in safety rules — it cannot switch off approvals.
        </p>
        <textarea
          aria-label="System prompt"
          className={styles.textarea}
          maxLength={20_000}
          value={draft}
          placeholder="e.g. Prefer my work Chrome profile. Write in British English."
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className={styles.row} style={{ justifyContent: "flex-end", marginTop: "var(--sp-2)" }}>
          <span className={styles.muted}>{draft.length.toLocaleString()} / 20,000</span>
          <Button size="sm" variant="ghost" disabled={draft === value} onClick={() => setDraft(value)}>
            Revert
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={draft === value}
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(draft);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save prompt
          </Button>
        </div>
      </div>
    </SettingSection>
  );
}
