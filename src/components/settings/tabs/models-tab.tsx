"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, SettingRow, SettingSection, SkeletonText } from "@/components/ui";
import { settingsFetch } from "@/hooks/use-settings";
import type { PriceOverride } from "@/lib/settings";
import { InlineError, NumberField, Select, Toggle } from "../controls";
import styles from "../settings-tabs.module.css";

interface VendorStatus {
  vendor: string;
  envKey: string;
  stored: { last4: string; updatedAt: string } | null;
  env: boolean;
  ready: boolean;
}

interface ModelRow {
  id: string;
  label: string;
  vendor: string;
  tier: string | null;
  note: string | null;
  enabled: boolean;
  price: PriceOverride;
  catalogPrice: PriceOverride;
  catalogEnabled: boolean;
  overridden: boolean;
  ready: boolean;
}

export interface ModelsView {
  vendors: VendorStatus[];
  models: ModelRow[];
  defaultModel: string | null;
  fallbackModel: string | null;
  catalogDefault: string;
  catalogFallback: string | null;
  effectiveDefault: string;
}

const VENDOR_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

export const MODELS_VIEW_KEY = ["settings", "models-view"] as const;

export function ModelsTab() {
  const qc = useQueryClient();
  const view = useQuery({
    queryKey: MODELS_VIEW_KEY,
    queryFn: () => settingsFetch<ModelsView>("/api/settings/models"),
  });

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      settingsFetch<ModelsView>("/api/settings/models", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      qc.setQueryData(MODELS_VIEW_KEY, data);
      // The prompt-bar picker and Agent tab read the same data.
      void qc.invalidateQueries({ queryKey: ["models"] });
      void qc.invalidateQueries({ queryKey: ["settings", "agent"] });
    },
  });

  if (!view.data) {
    return (
      <SettingSection title="Models">
        <div style={{ padding: "var(--sp-4)" }}>
          {view.error ? <InlineError error={view.error} /> : <SkeletonText lines={4} />}
        </div>
      </SettingSection>
    );
  }

  const data = view.data;
  const choices = data.models.map((m) => ({
    value: m.id,
    label: `${m.label}${m.enabled ? "" : " (disabled)"}${m.ready ? "" : " · no key"}`,
  }));

  return (
    <div className={styles.stack}>
      <SettingSection title="API keys">
        {data.vendors.map((v) => (
          <VendorKeyRow key={v.vendor} status={v} />
        ))}
      </SettingSection>

      <SettingSection title="Defaults">
        <SettingRow
          label="Default model"
          description={
            <>
              New chats start here. Now resolving to{" "}
              <span className={styles.mono}>{data.effectiveDefault}</span>.
            </>
          }
        >
          <Select
            label="Default model"
            value={data.defaultModel ?? data.catalogDefault}
            options={choices}
            onChange={(id) => update.mutate({ defaultModel: id })}
          />
        </SettingRow>
        <SettingRow
          label="Fallback model"
          description="Used when the default is disabled or has no key."
        >
          <Select
            label="Fallback model"
            value={data.fallbackModel ?? data.catalogFallback ?? ""}
            options={[{ value: "", label: "None" }, ...choices]}
            onChange={(id) => update.mutate({ fallbackModel: id || null })}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Models · price per million tokens (USD)">
        {data.models.map((m) => (
          <SettingRow
            key={m.id}
            label={m.label}
            description={
              <>
                <span className={styles.mono}>{m.id}</span>
                {!m.ready && ` · add a ${VENDOR_LABEL[m.vendor] ?? m.vendor} key to use`}
                {m.note && ` · ${m.note}`}
              </>
            }
          >
            <span className={styles.modelPrice}>
              <NumberField
                label={`${m.label} input price`}
                prefix="in"
                value={m.price.in}
                min={0}
                step={0.01}
                width={72}
                onCommit={(v) =>
                  update.mutate({ overrides: { [m.id]: { price: { ...m.price, in: v } } } })
                }
              />
              <NumberField
                label={`${m.label} output price`}
                prefix="out"
                value={m.price.out}
                min={0}
                step={0.01}
                width={72}
                onCommit={(v) =>
                  update.mutate({ overrides: { [m.id]: { price: { ...m.price, out: v } } } })
                }
              />
              {m.overridden && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => update.mutate({ overrides: { [m.id]: null } })}
                  title={`Reset to $${m.catalogPrice.in}/$${m.catalogPrice.out}, ${m.catalogEnabled ? "enabled" : "disabled"}`}
                >
                  Reset
                </Button>
              )}
              <Toggle
                label={`Enable ${m.label}`}
                checked={m.enabled}
                onChange={(enabled) => update.mutate({ overrides: { [m.id]: { enabled } } })}
              />
            </span>
          </SettingRow>
        ))}
      </SettingSection>
      <InlineError error={update.error} />
    </div>
  );
}

/**
 * Write-only key entry. The server returns last4 at most; there is no way to
 * read a key back, so "replace" is the only edit.
 */
function VendorKeyRow({ status }: { status: VendorStatus }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const label = VENDOR_LABEL[status.vendor] ?? status.vendor;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: MODELS_VIEW_KEY });
    void qc.invalidateQueries({ queryKey: ["models"] });
  };

  const save = useMutation({
    mutationFn: (key: string) =>
      settingsFetch<{ last4: string }>(`/api/settings/keys/${status.vendor}`, {
        method: "PUT",
        body: JSON.stringify({ key }),
      }),
    onSuccess: () => {
      setDraft("");
      setEditing(false);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      settingsFetch(`/api/settings/keys/${status.vendor}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const test = useMutation({
    mutationFn: () =>
      settingsFetch<{ detail: string }>(`/api/settings/keys/${status.vendor}/test`, {
        method: "POST",
      }),
  });

  const description = status.stored
    ? `Stored, ends in ••••${status.stored.last4}.`
    : status.env
      ? "Using the key from the server environment."
      : "No key yet — models from this vendor are unavailable.";

  return (
    <SettingRow
      label={label}
      description={
        <>
          {description}
          {test.isSuccess && <span className={styles.ok}> {test.data.detail}</span>}
          <InlineError error={save.error ?? remove.error ?? test.error} />
        </>
      }
    >
      {editing || (!status.stored && !status.env) ? (
        <form
          className={styles.row}
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) save.mutate(draft.trim());
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={`${label} API key`}
            placeholder="Paste key"
            className={`${styles.input} ${styles.wideInput}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button size="sm" variant="primary" type="submit" loading={save.isPending} disabled={!draft.trim()}>
            Save
          </Button>
          {editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </form>
      ) : (
        <span className={styles.row}>
          <Button size="sm" variant="ghost" loading={test.isPending} onClick={() => test.mutate()}>
            Test key
          </Button>
          <Button size="sm" onClick={() => setEditing(true)}>
            {status.stored ? "Replace" : "Add key"}
          </Button>
          {status.stored && (
            <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Remove
            </Button>
          )}
        </span>
      )}
    </SettingRow>
  );
}
