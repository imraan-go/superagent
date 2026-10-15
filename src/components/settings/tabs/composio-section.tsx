"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, HoldToConfirm, SettingRow, SettingSection, useToast } from "@/components/ui";
import { api, copy } from "./shared";
import styles from "./automation.module.css";
import cx from "./composio.module.css";

interface Account {
  id: string;
  toolkit: string;
  status: string;
  reason: string | null;
  scheme: string | null;
}
type Status =
  | { configured: false }
  | { configured: true; source: "settings" | "env"; last4: string | null; accounts: Account[]; mcp: { serverId: string } | null; triggers: number; error: string | null };

interface CatalogToolkit {
  slug: string;
  name: string;
  description: string;
  logo: string | null;
  categories: string[];
  authSchemes: string[];
  managedAuth: boolean;
  noAuth: boolean;
  toolsCount: number;
  triggersCount: number;
  authGuideUrl: string | null;
  pinned: boolean;
}
interface Catalog {
  items: CatalogToolkit[];
  total: number;
  categories: string[];
  catalogSize: number;
}
type ConnectResult =
  | { kind: "redirect"; redirectUrl: string }
  | { kind: "connected" }
  | { kind: "needs_credentials"; scheme: string; fields: Array<{ name: string; displayName: string; required: boolean; secret: boolean }> }
  | { kind: "unsupported"; reason: string; guideUrl: string | null };

const KEY = ["connectors", "composio"] as const;
const PAGE = 24;

const PENDING = new Set(["INITIALIZING", "INITIATED"]);

/** Settings -> Connectors -> Composio: key, catalog, connections, tools, MCP, triggers. */
export function ComposioSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({
    queryKey: KEY,
    queryFn: () => api<Status>("/api/connectors/composio"),
    // While an OAuth tab is open, poll until Composio reports ACTIVE.
    refetchInterval: (q) => {
      const d = q.state.data;
      return d?.configured && d.accounts.some((a) => PENDING.has(a.status)) ? 3000 : false;
    },
  });
  const [key, setKey] = useState("");
  const [creds, setCreds] = useState<{ toolkit: string; scheme: string; fields: Array<{ name: string; displayName: string; required: boolean; secret: boolean }>; values: Record<string, string> } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [toolsFor, setToolsFor] = useState<string | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: KEY });
  const onError = (e: Error) => toast.push({ title: "Composio", message: e.message, tone: "error" });

  const keyMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/api/connectors/composio", { method: "POST", body }),
    onSuccess: () => {
      setKey("");
      refresh();
      void qc.invalidateQueries({ queryKey: [...KEY, "catalog"] });
    },
    onError,
  });
  const connect = useMutation({
    mutationFn: (v: { toolkit: string; credentials?: Record<string, string> }) =>
      api<ConnectResult>("/api/connectors/composio", { method: "POST", body: { action: "connect", ...v } }),
    onSuccess: (r, v) => {
      setNote(null);
      if (r.kind === "redirect") {
        window.open(r.redirectUrl, "_blank", "noopener,noreferrer");
        setNote(`Finish authorising ${v.toolkit} in the new tab. This list updates by itself.`);
      } else if (r.kind === "needs_credentials") {
        setCreds({ toolkit: v.toolkit, scheme: r.scheme, fields: r.fields, values: {} });
      } else if (r.kind === "unsupported") {
        setNote(`${r.reason}${r.guideUrl ? ` Guide: ${r.guideUrl}` : ""}`);
      } else {
        setCreds(null);
        setNote(`${v.toolkit} connected.`);
      }
      refresh();
    },
    onError,
  });
  const disconnect = useMutation({
    mutationFn: (accountId: string) => api("/api/connectors/composio", { method: "POST", body: { action: "disconnect", accountId } }),
    onSuccess: refresh,
    onError,
  });

  const data = status.data;
  return (
    <SettingSection title="Composio">
      {status.isPending && <div className={styles.empty}>Loading…</div>}
      {status.error && <div className={styles.error}>{status.error.message}</div>}
      {data && !data.configured && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            keyMut.mutate({ action: "setKey", key });
          }}
        >
          <div className={styles.meta}>
            Add your Composio API key to browse every Composio toolkit, connect Gmail, Drive, Notion, LinkedIn, Slack and more, and give the agent their tools. It is stored encrypted and never shown again.
          </div>
          <div className={styles.formRow}>
            <input className={styles.input} type="password" autoComplete="off" placeholder="Composio API key" value={key} onChange={(e) => setKey(e.target.value)} required />
            <Button size="sm" variant="primary" type="submit" loading={keyMut.isPending}>
              Save key
            </Button>
          </div>
        </form>
      )}
      {data?.configured && (
        <>
          <SettingRow label="API key" description={data.source === "env" ? "From the environment" : `Stored · ••••${data.last4 ?? ""}`}>
            {data.source === "settings" && (
              <HoldToConfirm size="sm" tone="danger" onConfirm={() => keyMut.mutate({ action: "clearKey" })}>
                Remove
              </HoldToConfirm>
            )}
          </SettingRow>
          {data.error && <div className={styles.error}>{data.error}</div>}
          {note && <div className={styles.empty} role="status">{note}</div>}

          <div className={styles.list}>
            {data.accounts.length === 0 && <div className={styles.empty}>No connected apps yet. Pick one below.</div>}
            {data.accounts.map((a) => (
              <div key={a.id}>
                <div className={styles.item}>
                  <div>
                    <div className={styles.itemTitle}>
                      {a.toolkit}
                      <span className={a.status === "ACTIVE" ? cx.chipOk : PENDING.has(a.status) ? cx.chipWarn : cx.chip} style={{ marginLeft: "var(--sp-2)" }}>
                        {a.status.toLowerCase()}
                      </span>
                    </div>
                    <div className={styles.meta}>
                      {a.reason ? `${a.reason} · ` : ""}Tools appear to the agent as composio__{a.toolkit}__…
                    </div>
                  </div>
                  <div className={styles.actions}>
                    {a.status === "ACTIVE" && (
                      <Button size="sm" variant="outline" onClick={() => setToolsFor(toolsFor === a.toolkit ? null : a.toolkit)}>
                        Tools
                      </Button>
                    )}
                    {a.status !== "ACTIVE" && (
                      <Button size="sm" variant="outline" loading={connect.isPending && connect.variables?.toolkit === a.toolkit} onClick={() => connect.mutate({ toolkit: a.toolkit })}>
                        Re-authorise
                      </Button>
                    )}
                    <HoldToConfirm size="sm" tone="danger" onConfirm={() => disconnect.mutate(a.id)}>
                      Disconnect
                    </HoldToConfirm>
                  </div>
                </div>
                {toolsFor === a.toolkit && a.status === "ACTIVE" && <ToolsPanel toolkit={a.toolkit} />}
              </div>
            ))}
          </div>

          {creds && (
            <form
              className={styles.form}
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                connect.mutate(
                  { toolkit: creds.toolkit, credentials: creds.values },
                  { onSuccess: (r) => r.kind === "connected" && setCreds(null) },
                );
              }}
            >
              <div className={styles.itemTitle}>Connect {creds.toolkit} ({creds.scheme.replace("_", " ").toLowerCase()})</div>
              <div className={styles.meta}>These values go straight to Composio. This panel does not store, log or display them.</div>
              {creds.fields.map((f) => (
                <input
                  key={f.name}
                  className={styles.input}
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  placeholder={f.displayName + (f.required ? "" : " (optional)")}
                  required={f.required}
                  value={creds.values[f.name] ?? ""}
                  onChange={(e) => setCreds({ ...creds, values: { ...creds.values, [f.name]: e.target.value } })}
                />
              ))}
              <div className={styles.formRow}>
                <Button size="sm" variant="primary" type="submit" loading={connect.isPending}>
                  Connect
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCreds(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          <Catalog accounts={data.accounts} onConnect={(toolkit) => connect.mutate({ toolkit })} connecting={connect.isPending ? (connect.variables?.toolkit ?? null) : null} />
          <McpBlock />
          <TriggersBlock />
        </>
      )}
    </SettingSection>
  );
}

function Catalog({ accounts, onConnect, connecting }: { accounts: Account[]; onConnect: (toolkit: string) => void; connecting: string | null }) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search);
      setLimit(PAGE);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  const { data, isPending, error } = useQuery({
    queryKey: [...KEY, "catalog", q, category, limit],
    queryFn: () => api<Catalog>(`/api/connectors/composio/catalog?${new URLSearchParams({ q, category, limit: String(limit) })}`),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
  const connected = new Set(accounts.filter((a) => a.status === "ACTIVE").map((a) => a.toolkit));

  return (
    <>
      <div className={cx.toolbar}>
        <input className={styles.input} type="search" placeholder={`Search ${data?.catalogSize ?? "all"} toolkits…`} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search toolkits" />
        <select className={styles.select} value={category} onChange={(e) => { setCategory(e.target.value); setLimit(PAGE); }} aria-label="Category">
          <option value="">All categories</option>
          {data?.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {error && <div className={styles.error}>{error.message}</div>}
      {isPending && <div className={styles.empty}>Loading the Composio catalog…</div>}
      {data && data.items.length === 0 && <div className={styles.empty}>No toolkits match.</div>}
      <div className={cx.grid}>
        {data?.items.map((t) => (
          <article key={t.slug} className={cx.card} data-pinned={t.pinned}>
            <div className={cx.cardHead}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {t.logo ? <img className={cx.logo} src={`/api/connectors/composio/logo?slug=${encodeURIComponent(t.slug)}`} alt="" loading="lazy" width={24} height={24} /> : <span className={cx.logo} />}
              <span className={cx.cardName} title={t.name}>
                {t.name}
              </span>
            </div>
            <div className={cx.desc}>{t.description || t.slug}</div>
            <div className={cx.cardFoot}>
              <div className={cx.chips}>
                <span className={cx.chip}>{t.noAuth ? "no auth" : (t.authSchemes[0] ?? "auth").replace("_", " ").toLowerCase()}</span>
                {!t.noAuth && !t.managedAuth && <span className={cx.chipWarn}>own app</span>}
                <span className={`${cx.chip} ${cx.num}`}>{t.toolsCount} tools</span>
                {t.triggersCount > 0 && <span className={`${cx.chip} ${cx.num}`}>{t.triggersCount} triggers</span>}
              </div>
              {connected.has(t.slug) ? (
                <span className={cx.chipOk}>connected</span>
              ) : (
                <Button size="sm" variant="outline" loading={connecting === t.slug} onClick={() => onConnect(t.slug)}>
                  Connect
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {data && data.items.length < data.total && (
        <div className={cx.more}>
          <Button size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE)}>
            Show more ({data.total - data.items.length} left)
          </Button>
        </div>
      )}
    </>
  );
}

interface ToolView {
  slug: string;
  action: string;
  description: string;
  readOnly: boolean;
  schemaTokens: number;
  enabled: boolean;
}

function ToolsPanel({ toolkit }: { toolkit: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const k = [...KEY, "tools", toolkit];
  const { data, isPending, error } = useQuery({
    queryKey: k,
    queryFn: () => api<{ tools: ToolView[]; customized: boolean; schemaTokens: number }>(`/api/connectors/composio/tools?toolkit=${encodeURIComponent(toolkit)}`),
  });
  const [sel, setSel] = useState<Set<string> | null>(null);
  const current = sel ?? new Set(data?.tools.filter((t) => t.enabled).map((t) => t.slug));
  const tokens = data?.tools.filter((t) => current.has(t.slug)).reduce((n, t) => n + t.schemaTokens, 0) ?? 0;
  const save = useMutation({
    mutationFn: (enabled: string[] | null) => api("/api/connectors/composio/tools", { method: "PUT", body: { toolkit, enabled } }),
    onSuccess: () => {
      setSel(null);
      void qc.invalidateQueries({ queryKey: k });
      toast.push({ title: "Tools saved", message: `${toolkit} tool selection updated.`, tone: "success" });
    },
    onError: (e: Error) => toast.push({ title: "Composio", message: e.message, tone: "error" }),
  });
  const toggle = (slug: string) => {
    const next = new Set(current);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setSel(next);
  };

  return (
    <div className={cx.panelBody}>
      {isPending && <div className={styles.empty}>Loading tools…</div>}
      {error && <div className={styles.error}>{error.message}</div>}
      {data && (
        <>
          <div className={cx.urlBox}>
            <span className={styles.meta}>
              <span className={cx.num}>{current.size}</span> of <span className={cx.num}>{data.tools.length}</span> enabled · schema tokens <span className={cx.num}>~{tokens}</span> · write tools stay off by default and always ask first
            </span>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" disabled={!data.customized && !sel} onClick={() => save.mutate(null)}>
              Reset
            </Button>
            <Button size="sm" variant="primary" disabled={!sel} loading={save.isPending} onClick={() => save.mutate([...current])}>
              Save
            </Button>
          </div>
          <div className={cx.scroll}>
            {data.tools.map((t) => (
              <label key={t.slug} className={cx.toolRow}>
                <input type="checkbox" checked={current.has(t.slug)} onChange={() => toggle(t.slug)} />
                <span>
                  <span className={styles.itemTitle}>{t.action}</span>
                  <span className={cx.chip} style={{ marginLeft: "var(--sp-2)" }}>{t.readOnly ? "read" : "write · asks"}</span>
                  <div className={styles.meta}>{t.description}</div>
                </span>
                <span className={`${styles.meta} ${cx.num}`}>~{t.schemaTokens}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function McpBlock() {
  const qc = useQueryClient();
  const toast = useToast();
  const k = [...KEY, "mcp"];
  const { data } = useQuery({
    queryKey: k,
    queryFn: () => api<{ exists: boolean; panelServerId: string | null; enabledInPanel: boolean; url: string | null; secretBearing: boolean }>("/api/connectors/composio/mcp"),
  });
  const [reveal, setReveal] = useState(false);
  const act = useMutation({
    mutationFn: (m: "POST" | "DELETE") => api("/api/connectors/composio/mcp", { method: m }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: k }),
    onError: (e: Error) => toast.push({ title: "Composio MCP", message: e.message, tone: "error" }),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api(`/api/connectors/mcp/${data?.panelServerId}`, { method: "PATCH", body: { enabled } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: k }),
    onError: (e: Error) => toast.push({ title: "Composio MCP", message: e.message, tone: "error" }),
  });
  const masked = data?.url ? (reveal || !data.secretBearing ? data.url : data.url.replace(/=[^&]+/g, "=••••")) : "";

  return (
    <div className={cx.panelBody}>
      <SettingRow
        label="Use via MCP"
        description="A Composio-hosted MCP server limited to your connected apps and enabled tools. Direct execution stays the default; turning this on as well would list tools twice."
      >
        <div className={styles.actions}>
          <Button size="sm" variant="outline" loading={act.isPending} onClick={() => act.mutate("POST")}>
            {data?.exists ? "Refresh server" : "Create server"}
          </Button>
          {data?.exists && (
            <HoldToConfirm size="sm" tone="danger" onConfirm={() => act.mutate("DELETE")}>
              Delete
            </HoldToConfirm>
          )}
        </div>
      </SettingRow>
      {data?.exists && data.url && (
        <>
          <div className={cx.urlBox}>
            <code className={`${styles.code} ${cx.urlText}`}>{masked}</code>
            {data.secretBearing && (
              <Button size="sm" variant="ghost" onClick={() => setReveal(!reveal)}>
                {reveal ? "Hide" : "Reveal"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => copy(data.url!)}>
              Copy
            </Button>
          </div>
          <div className={styles.meta} style={{ padding: "0 var(--sp-4) var(--sp-3)" }}>
            {data.secretBearing ? "This URL carries credentials: keep it private. " : ""}
            Authenticate external clients with the x-api-key header. Never shown to the model.
          </div>
          <SettingRow label="Expose to the agent via MCP" description={`Registered as the remote MCP server "composio" (tools mcp__composio__…), off by default.`}>
            <Button size="sm" variant={data.enabledInPanel ? "primary" : "outline"} loading={toggle.isPending} onClick={() => toggle.mutate(!data.enabledInPanel)}>
              {data.enabledInPanel ? "On" : "Off"}
            </Button>
          </SettingRow>
        </>
      )}
    </div>
  );
}

interface TriggerType {
  slug: string;
  name: string;
  description: string;
  toolkit: string;
  hasConfig: boolean;
  enabled: { triggerId: string; webhookId: string } | null;
}

function TriggersBlock() {
  const qc = useQueryClient();
  const toast = useToast();
  const k = [...KEY, "triggers"];
  const [open, setOpen] = useState(false);
  const { data, isPending, error } = useQuery({
    queryKey: k,
    enabled: open,
    queryFn: () => api<{ webhookUrl: string; accounts: Array<{ id: string; toolkit: string }>; types: TriggerType[] }>("/api/connectors/composio/triggers"),
  });
  const [draft, setDraft] = useState<{ slug: string; prompt: string } | null>(null);
  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/api/connectors/composio/triggers", { method: "POST", body }),
    onSuccess: () => {
      setDraft(null);
      void qc.invalidateQueries({ queryKey: k });
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: Error) => toast.push({ title: "Composio trigger", message: e.message, tone: "error" }),
  });
  const enable = (t: TriggerType) => {
    const acc = data?.accounts.find((a) => a.toolkit === t.toolkit);
    if (!acc || !draft) return;
    act.mutate({ action: "enable", slug: t.slug, toolkit: t.toolkit, connectedAccountId: acc.id, prompt: draft.prompt });
  };

  return (
    <div className={cx.panelBody}>
      <SettingRow label="Triggers" description="Run an agent prompt when something happens in a connected app (new email, new issue…). Event data is passed to the agent as untrusted data; runs obey the daily budget guard.">
        <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Browse"}
        </Button>
      </SettingRow>
      {open && isPending && <div className={styles.empty}>Loading triggers…</div>}
      {open && error && <div className={styles.error}>{error.message}</div>}
      {open && data && data.types.length === 0 && <div className={styles.empty}>Connected apps expose no triggers.</div>}
      {open && data && (
        <div className={cx.scroll}>
          {data.types.map((t) => (
            <div key={t.slug} className={styles.item}>
              <div>
                <div className={styles.itemTitle}>
                  {t.name} <span className={cx.chip}>{t.toolkit}</span>
                </div>
                <div className={styles.meta}>{t.description}</div>
                {draft?.slug === t.slug && (
                  <div className={styles.formRow} style={{ marginTop: "var(--sp-2)" }}>
                    <textarea className={styles.textarea} placeholder="What should the agent do when this fires?" value={draft.prompt} onChange={(e) => setDraft({ slug: t.slug, prompt: e.target.value })} />
                    <Button size="sm" variant="primary" disabled={!draft.prompt.trim()} loading={act.isPending} onClick={() => enable(t)}>
                      Enable
                    </Button>
                  </div>
                )}
              </div>
              <div className={styles.actions}>
                {t.enabled ? (
                  <HoldToConfirm size="sm" tone="danger" onConfirm={() => act.mutate({ action: "disable", triggerId: t.enabled!.triggerId })}>
                    Disable
                  </HoldToConfirm>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setDraft({ slug: t.slug, prompt: "" })}>
                    Set up
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
