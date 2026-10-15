"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, HoldToConfirm, SettingRow, SettingSection, useToast } from "@/components/ui";
import { api } from "./shared";
import { ComposioSection } from "./composio-section";
import styles from "./automation.module.css";

interface McpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  hasBearer: boolean;
  builtin: boolean;
}

/** Settings → Connectors: Composio, Pipedream, custom REST (LHOS vault) and remote MCP. */
export function ConnectorsTab() {
  return (
    <div className={styles.stack}>
      <ComposioSection />
      <PipedreamSection />
      <CustomSection />
      <McpSection />
    </div>
  );
}

function useAction<T>(fn: (v: T) => Promise<unknown>, keys: string[], onDone?: (d: unknown) => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (d) => {
      onDone?.(d);
      void qc.invalidateQueries({ queryKey: keys });
    },
    onError: (e: Error) => toast.push({ title: "Connector action failed", message: e.message, tone: "error" }),
  });
}

function PipedreamSection() {
  const KEY = ["connectors", "pipedream"];
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () =>
      api<{ sourceHost: string | null; hasApiKey: boolean; workflows: Array<{ id: string; name: string }> | null; error: string | null }>(
        "/api/connectors/pipedream",
      ),
  });
  const [url, setUrl] = useState("");
  const save = useAction((sourceUrl: string | null) => api("/api/connectors/pipedream", { method: "POST", body: { sourceUrl } }), KEY, () => setUrl(""));

  return (
    <SettingSection title="Pipedream">
      <SettingRow label="Inbound" description="Create a webhook under Triggers & Webhooks and paste its URL + signing recipe into a Pipedream HTTP step." >
        <span className={styles.meta}>—</span>
      </SettingRow>
      <SettingRow
        label="Outbound source"
        description={data?.sourceHost ? `Agent tool pipedream__emit posts to ${data.sourceHost} (asks before sending).` : "Paste a Pipedream source URL to give the agent pipedream__emit."}
      >
        {data?.sourceHost && (
          <HoldToConfirm size="sm" tone="danger" onConfirm={() => save.mutate(null)}>
            Remove
          </HoldToConfirm>
        )}
      </SettingRow>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(url);
        }}
      >
        <div className={styles.formRow}>
          <input className={styles.input} type="url" placeholder="https://xxxx.m.pipedream.net" value={url} onChange={(e) => setUrl(e.target.value)} required />
          <Button size="sm" variant="primary" type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
      {data?.hasApiKey && (
        <div className={styles.list}>
          {data.error && <div className={styles.error}>{data.error}</div>}
          {data.workflows?.map((w) => (
            <div className={styles.item} key={w.id}>
              <div className={styles.itemTitle}>{w.name}</div>
              <span className={styles.mono}>{w.id}</span>
            </div>
          ))}
        </div>
      )}
    </SettingSection>
  );
}

function CustomSection() {
  const KEY = ["connectors", "custom"];
  const { data, isPending, error } = useQuery({
    queryKey: KEY,
    queryFn: () =>
      api<{ connectors: unknown[]; credentials: unknown[]; intakeUrl: string | null; error: string | null }>("/api/connectors/custom"),
  });
  const [form, setForm] = useState({ name: "", baseUrl: "", credential: "" });
  const save = useAction(() => api("/api/connectors/custom", { method: "POST", body: form }), KEY, () =>
    setForm({ name: "", baseUrl: "", credential: "" }),
  );
  const label = (c: unknown) => {
    const r = c as { name?: string; base_url?: string; host?: string };
    return { name: r.name ?? JSON.stringify(c), sub: r.base_url ?? r.host ?? "" };
  };

  return (
    <SettingSection title="Custom REST connectors (LHOS vault)">
      <SettingRow
        label="Add an API key"
        description="Keys are typed on the LHOS vault page — never in chat, never through the panel. Then reference the credential name below."
      >
        <Button size="sm" variant="outline" disabled={!data?.intakeUrl} onClick={() => data?.intakeUrl && window.open(data.intakeUrl, "_blank", "noopener,noreferrer")}>
          Open vault intake
        </Button>
      </SettingRow>
      <div className={styles.list}>
        {isPending && <div className={styles.empty}>Loading…</div>}
        {(error || data?.error) && <div className={styles.error}>{error?.message ?? data?.error}</div>}
        {data?.connectors.length === 0 && <div className={styles.empty}>No connectors defined.</div>}
        {data?.connectors.map((c, i) => {
          const l = label(c);
          return (
            <div className={styles.item} key={`c${i}`}>
              <div>
                <div className={styles.itemTitle}>{l.name}</div>
                <div className={`${styles.meta} ${styles.mono}`}>{l.sub}</div>
              </div>
            </div>
          );
        })}
        {data && data.credentials.length > 0 && (
          <div className={styles.empty}>Vault credentials: {data.credentials.map((c) => label(c).name).join(", ")}</div>
        )}
      </div>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <div className={styles.formRow}>
          <input className={styles.input} placeholder="Name (e.g. meta)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className={styles.input} type="url" placeholder="https://api.example.com/v1" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} required />
          <input className={styles.input} placeholder="Vault credential name" value={form.credential} onChange={(e) => setForm({ ...form, credential: e.target.value })} />
          <Button size="sm" variant="primary" type="submit" loading={save.isPending}>
            Save connector
          </Button>
        </div>
      </form>
    </SettingSection>
  );
}

function McpSection() {
  const KEY = ["connectors", "mcp"];
  const { data } = useQuery({ queryKey: KEY, queryFn: () => api<{ servers: McpServer[] }>("/api/connectors/mcp") });
  const [form, setForm] = useState({ name: "", url: "", bearer: "" });
  const [tools, setTools] = useState<Record<string, string>>({});
  const add = useAction(() => api("/api/connectors/mcp", { method: "POST", body: { ...form, bearer: form.bearer || undefined } }), KEY, () =>
    setForm({ name: "", url: "", bearer: "" }),
  );
  const act = useAction(
    (v: { id: string; op: "toggle" | "delete"; enabled?: boolean }) =>
      v.op === "toggle"
        ? api(`/api/connectors/mcp/${v.id}`, { method: "PATCH", body: { enabled: v.enabled } })
        : api(`/api/connectors/mcp/${v.id}`, { method: "DELETE" }),
    KEY,
  );
  const test = async (id: string) => {
    setTools((t) => ({ ...t, [id]: "Connecting…" }));
    try {
      const r = await api<{ ok: boolean; error?: string; tools: Array<{ name: string }> }>(`/api/connectors/mcp/${id}`);
      setTools((t) => ({ ...t, [id]: r.ok ? `${r.tools.length} tools: ${r.tools.map((x) => x.name).join(", ")}` : `Failed: ${r.error}` }));
    } catch (e) {
      setTools((t) => ({ ...t, [id]: `Failed: ${(e as Error).message}` }));
    }
  };

  return (
    <SettingSection title="Remote MCP servers">
      <div className={styles.list}>
        {data?.servers.map((s) => (
          <div className={styles.item} key={s.id}>
            <div>
              <div className={styles.itemTitle}>
                {s.name}
                {s.builtin && <span className={styles.badge}>built-in · read-only</span>}
                {!s.enabled && <span className={styles.badge}>off</span>}
              </div>
              <div className={`${styles.meta} ${styles.mono}`}>{s.url}</div>
              <div className={styles.meta}>
                {s.builtin ? "Already available to the agent through LHOS REST." : `Tools appear as mcp__${s.name}__<tool>.`}
                {tools[s.id] ? ` ${tools[s.id]}` : ""}
              </div>
            </div>
            <div className={styles.actions}>
              <Button size="sm" variant="ghost" onClick={() => void test(s.id)}>
                Test
              </Button>
              {!s.builtin && (
                <>
                  <Button size="sm" variant="outline" onClick={() => act.mutate({ id: s.id, op: "toggle", enabled: !s.enabled })}>
                    {s.enabled ? "Disable" : "Enable"}
                  </Button>
                  <HoldToConfirm size="sm" tone="danger" onConfirm={() => act.mutate({ id: s.id, op: "delete" })}>
                    Remove
                  </HoldToConfirm>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined);
        }}
      >
        <div className={styles.formRow}>
          <input className={styles.input} placeholder="name (a-z, 0-9, _)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className={styles.input} type="url" placeholder="https://server.example/mcp" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
          <input className={styles.input} type="password" autoComplete="off" placeholder="Bearer token (optional)" value={form.bearer} onChange={(e) => setForm({ ...form, bearer: e.target.value })} />
          <Button size="sm" variant="primary" type="submit" loading={add.isPending}>
            Add server
          </Button>
        </div>
      </form>
    </SettingSection>
  );
}
