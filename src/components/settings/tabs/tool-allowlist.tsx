"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, SettingSection, SkeletonText } from "@/components/ui";
import { settingsFetch } from "@/hooks/use-settings";
import { DEFAULT_TOOL_ALLOWLIST } from "@/server/agent/allowlist";
import { lockedToolReason } from "@/server/agent/guard";
import { requiresApproval } from "@/server/agent/policy";
import { groupByCategory } from "@/lib/tool-categories";
import {
  PRESETS,
  computePreset,
  estimateSchemaTokens,
  isLocked,
  matchingPreset,
  needsApproval,
  sanitizeSelection,
  shortDescription,
  toggleNames,
} from "@/lib/tool-allowlist";
import type { PresetId } from "@/lib/tool-allowlist";
import { InlineError } from "../controls";
import styles from "../settings-tabs.module.css";

interface ToolSummary {
  name: string;
  description: string;
  schemaChars: number;
}

const DEFAULTS = new Set<string>(DEFAULT_TOOL_ALLOWLIST);

/**
 * Settings -> Agent -> Tool allowlist. The checkbox state is always derived from
 * the saved setting as the server will apply it: locked tools and names that are
 * not in the live catalog are never offered to the model, so they never show as on.
 */
export function ToolAllowlistSection({
  value,
  onSave,
  onSaved,
}: {
  /** Saved allowlist; undefined = never customised (built-in default). */
  value: string[] | undefined;
  onSave: (next: string[] | null) => Promise<unknown>;
  /** Called after a save settles so the caller can re-read server truth. */
  onSaved: () => unknown;
}) {
  const catalog = useQuery({
    queryKey: ["lhos", "tools"],
    queryFn: () => settingsFetch<{ tools: ToolSummary[] }>("/api/lhos/tools"),
    staleTime: 5 * 60_000,
  });
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const tools = useMemo(() => catalog.data?.tools ?? [], [catalog.data]);
  const available = useMemo(() => tools.map((t) => t.name), [tools]);
  const sizes = useMemo(() => new Map(tools.map((t) => [t.name, t.schemaChars ?? 0] as const)), [tools]);

  // What the server will actually offer to the model.
  const effective = useMemo(
    () => new Set(sanitizeSelection(value ?? DEFAULT_TOOL_ALLOWLIST, available)),
    [value, available],
  );
  const ignored = useMemo(
    () => (value ?? [...DEFAULTS]).filter((n) => !effective.has(n)),
    [value, effective],
  );
  const lockedCount = available.filter(isLocked).length;
  const active = matchingPreset(effective, available);
  const tokens = estimateSchemaTokens([...effective].map((n) => sizes.get(n) ?? 0));

  const needle = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      groupByCategory(
        tools.filter((t) => !needle || t.name.includes(needle) || t.description.toLowerCase().includes(needle)),
      ),
    [tools, needle],
  );

  const commit = async (next: string[] | null) => {
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      await onSaved();
      setSaving(false);
    }
  };

  const applyNames = (next: Set<string>) => commit(sanitizeSelection(next, available));
  const applyPreset = (id: PresetId) =>
    id === "recommended" ? commit(null) : commit(computePreset(id, available));

  const ready = catalog.isSuccess;

  return (
    <SettingSection title="Tool allowlist">
      <div style={{ padding: "var(--sp-4)" }}>
        <div className={styles.allowIntro}>
          <p>
            The agent only sees the tools you enable here. Every enabled tool sends its description and
            argument schema with every model call, so more tools means slower, costlier and less focused runs.
            The default is about 50 of the {available.length || 100} tools. Raw click/type tools and RDP are
            opt-in because the structured browser and OCR tools are more reliable.
          </p>
          <ul>
            <li>Approval checkpoints still apply to every enabled tool that sends, posts, pays, deletes or shares.</li>
            <li>
              Locked tools can never be called by the agent, even if listed: trigger URLs, vault intake, and
              creating schedules, workflows or connectors. You do those yourself in Settings.
            </li>
          </ul>
        </div>

        {catalog.isPending && <SkeletonText lines={3} />}
        {catalog.error && <InlineError error={catalog.error} />}

        {ready && (
          <>
            <div className={styles.allowStats} aria-live="polite">
              <strong>{effective.size}</strong> of {available.length} tools enabled
              {lockedCount > 0 && <> ({lockedCount} locked)</>}
              <span className={styles.muted}>
                {" "}
                - about {tokens.toLocaleString()} schema tokens per call (~estimate)
              </span>
              {saving && <span className={styles.muted}> - saving...</span>}
            </div>
            {ignored.length > 0 && (
              <p className={styles.muted} style={{ margin: "var(--sp-1) 0 0" }}>
                {ignored.length} saved {ignored.length === 1 ? "entry is" : "entries are"} ignored by the agent
                (locked, or not a tool on the agent computer): {ignored.slice(0, 6).join(", ")}
                {ignored.length > 6 ? ", ..." : ""}. They are dropped on your next change.
              </p>
            )}

            <div className={styles.allowToolbar}>
              <div className={styles.row} role="group" aria-label="Presets">
                {PRESETS.map((p) => (
                  <Button
                    key={p.id}
                    size="sm"
                    variant={active === p.id ? "primary" : "secondary"}
                    title={p.hint}
                    aria-pressed={active === p.id}
                    disabled={saving}
                    onClick={() => void applyPreset(p.id)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <input
                type="search"
                aria-label="Filter tools"
                className={styles.input + " " + styles.wideInput}
                placeholder="Filter tools..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {groups.length === 0 && <p className={styles.muted}>No tools match this filter.</p>}
            {groups.map(({ category, tools: list }) => {
              const names = list.map((t) => t.name);
              const toggleable = names.filter((n) => !isLocked(n));
              const on = list.filter((t) => effective.has(t.name)).length;
              const allOn = toggleable.length > 0 && toggleable.every((n) => effective.has(n));
              return (
                <details key={category.id} className={styles.toolGroup} open={needle ? true : undefined}>
                  <summary>
                    <span>
                      <span className={styles.toolGroupName}>{category.label}</span>
                      <span className={styles.muted}> - {category.hint}</span>
                    </span>
                    <span className={styles.row + " " + styles.allowGroupActions}>
                      <span className={styles.muted + " " + styles.mono}>
                        {on}/{list.length} enabled
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={saving || toggleable.length === 0}
                        onClick={(e) => {
                          e.preventDefault();
                          void applyNames(toggleNames(effective, names, !allOn));
                        }}
                      >
                        {allOn ? "Disable all" : "Enable all"}
                      </Button>
                    </span>
                  </summary>
                  <div className={styles.allowRows}>
                    {list.map((t) => (
                      <ToolRow
                        key={t.name}
                        tool={t}
                        checked={effective.has(t.name)}
                        disabled={saving}
                        onToggle={(next) => void applyNames(toggleNames(effective, [t.name], next))}
                      />
                    ))}
                  </div>
                </details>
              );
            })}
          </>
        )}
      </div>
    </SettingSection>
  );
}

function ToolRow({
  tool,
  checked,
  disabled,
  onToggle,
}: {
  tool: ToolSummary;
  checked: boolean;
  disabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  const lock = lockedToolReason(tool.name);
  const approval = !lock && needsApproval(tool.name);
  const approvalReason = approval ? (requiresApproval(tool.name).reason ?? "outbound write requests") : null;
  return (
    <label
      className={styles.allowRow + (lock ? " " + styles.allowLocked : "")}
      title={lock ? "Blocked for safety: " + lock : tool.description}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || lock !== null}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <span className={styles.allowBody}>
        <span className={styles.row}>
          <span className={styles.toolName}>{tool.name}</span>
          {DEFAULTS.has(tool.name) && !lock && <span className={styles.badge}>Default</span>}
          {approval && (
            <span className={styles.badge + " " + styles.badgeWarn} title={"Asks you first: " + approvalReason}>
              Needs approval
            </span>
          )}
          {lock && (
            <span className={styles.badge + " " + styles.badgeLock} title={"Blocked for safety: " + lock}>
              Locked
            </span>
          )}
        </span>
        <span className={styles.muted}>{shortDescription(tool.description)}</span>
      </span>
    </label>
  );
}
