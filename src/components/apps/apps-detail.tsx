"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Lightning, ShareNetwork, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { api } from "@/components/settings/tabs/shared";
import { Button, HoldToConfirm, SkeletonText, useToast } from "@/components/ui";
import { maskId, prettyCategory } from "@/lib/apps";
import { openSettings } from "@/lib/app-events";
import { COMPOSIO_STATUS_KEY } from "@/lib/composio-types";
import type { ToolkitDetail } from "@/lib/composio-types";
import { AppLogo } from "./app-logo";
import { useApps } from "./apps-context";
import { CredsForm } from "./creds-form";
import styles from "./apps.module.css";

export const DETAIL_KEY = (slug: string) => [...COMPOSIO_STATUS_KEY, "toolkit", slug] as const;
const TOOL_STEP = 40;

export function shareLink(slug: string): string {
  return `${window.location.origin}/?app=${encodeURIComponent(slug)}`;
}

export function AppsDetail({ slug }: { slug: string }) {
  const toast = useToast();
  const apps = useApps();
  const q = useQuery({
    queryKey: DETAIL_KEY(slug),
    queryFn: () => api<ToolkitDetail>(`/api/connectors/composio/toolkit?slug=${encodeURIComponent(slug)}`),
    staleTime: 60_000,
  });

  if (q.isPending) {
    return (
      <div className={styles.pad} aria-busy>
        <SkeletonText lines={2} />
        <SkeletonText lines={6} />
      </div>
    );
  }
  if (q.error) {
    return (
      <div className={styles.pad} role="alert">
        <p className={styles.err}>{q.error.message}</p>
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const d = q.data;
  const tk = d.toolkit;
  const st = apps.stateOf(tk.slug);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(shareLink(tk.slug));
      toast.push({ title: "Link copied", message: `Deep link to ${tk.name} copied.`, tone: "success" });
    } catch {
      toast.push({ title: "Copy failed", message: shareLink(tk.slug), tone: "error" });
    }
  };
  const showCreds = apps.creds?.toolkit === tk.slug;

  return (
    <div className={styles.detail}>
      <header className={styles.detailHead}>
        <AppLogo slug={tk.slug} name={tk.name} size={64} />
        <div className={styles.detailTitle}>
          <h3 className={styles.detailName}>{tk.name}</h3>
          <div className={styles.detailLinks}>
            <a href={d.composioUrl} target="_blank" rel="noopener noreferrer" className={styles.link}>
              View on Composio <ArrowUpRight size={12} aria-hidden />
            </a>
            <button type="button" className={styles.link} onClick={() => void share()}>
              <ShareNetwork size={12} aria-hidden /> Share
            </button>
          </div>
        </div>
        <div className={styles.detailActions}>
          {st?.status === "ACTIVE" ? (
            <>
              <span className={styles.okChip}>Connected</span>
              <HoldToConfirm size="sm" tone="danger" onConfirm={() => apps.disconnect(st.account.id)} disabled={apps.disconnecting}>
                Disconnect
              </HoldToConfirm>
            </>
          ) : st?.status === "PENDING" ? (
            <>
              <Button size="md" disabled>
                Waiting for authorisation…
              </Button>
              <HoldToConfirm size="sm" tone="danger" onConfirm={() => apps.disconnect(st.account.id)}>
                Cancel
              </HoldToConfirm>
            </>
          ) : st?.status === "EXPIRED" ? (
            <>
              <Button size="md" variant="attention" loading={apps.connecting === tk.slug} onClick={() => apps.connect(tk.slug, tk.name)}>
                Re-authenticate
              </Button>
              <HoldToConfirm size="sm" tone="danger" onConfirm={() => apps.disconnect(st.account.id)}>
                Remove
              </HoldToConfirm>
            </>
          ) : (
            <Button size="md" variant="primary" loading={apps.connecting === tk.slug} onClick={() => apps.connect(tk.slug, tk.name)}>
              Connect
            </Button>
          )}
        </div>
      </header>

      {apps.note && (
        <p className={styles.note} role="status">
          {apps.note.text}{" "}
          {apps.note.href && (
            <a href={apps.note.href} target="_blank" rel="noopener noreferrer" className={styles.link}>
              {apps.note.hrefLabel ?? "Open"} <ArrowUpRight size={12} aria-hidden />
            </a>
          )}
        </p>
      )}

      {showCreds && <CredsForm />}

      <p className={styles.detailDesc}>{tk.description || "No description provided."}</p>

      <ToolsSection detail={d} slug={tk.slug} />

      <section className={styles.block} aria-labelledby="apps-triggers">
        <h4 id="apps-triggers" className={styles.blockHead}>
          Triggers <span className={styles.num}>{d.triggers.length}</span>
        </h4>
        {d.triggers.length === 0 ? (
          <p className={styles.muted}>This app has no triggers.</p>
        ) : (
          <>
            <ul className={styles.list}>
              {d.triggers.map((t) => (
                <li key={t.slug} className={styles.item}>
                  <Lightning size={16} className={styles.itemIcon} aria-hidden />
                  <div className={styles.itemBody}>
                    <span className={styles.itemName}>{t.name}</span>
                    <span className={styles.itemDesc}>{t.description || t.slug}</span>
                  </div>
                  <span className={styles.badge}>{t.kind}</span>
                </li>
              ))}
            </ul>
            <p className={styles.muted}>
              Set a trigger up under{" "}
              <button type="button" className={styles.link} onClick={() => openSettings("connectors")}>
                Settings → Connectors
              </button>
              ; events then start an LHOS run.
            </p>
          </>
        )}
      </section>

      <Information detail={d} account={st} updatedAt={q.dataUpdatedAt} />
    </div>
  );
}

function ToolsSection({ detail, slug }: { detail: ToolkitDetail; slug: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState(TOOL_STEP);
  const key = DETAIL_KEY(slug);

  const save = useMutation({
    mutationFn: (enabled: string[] | null) => api("/api/connectors/composio/tools", { method: "PUT", body: { toolkit: slug, enabled } }),
    onMutate: async (enabled) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ToolkitDetail>(key);
      if (prev && enabled) {
        const on = new Set(enabled);
        const tools = prev.tools.map((t) => ({ ...t, enabled: on.has(t.slug) }));
        qc.setQueryData<ToolkitDetail>(key, { ...prev, tools, enabledCount: tools.filter((t) => t.enabled).length, customized: true });
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.push({ title: "Tools", message: e.message, tone: "error" });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: [...COMPOSIO_STATUS_KEY, "installed"] });
    },
  });

  const needle = filter.trim().toLowerCase();
  const rows = needle ? detail.tools.filter((t) => `${t.name} ${t.slug} ${t.description}`.toLowerCase().includes(needle)) : detail.tools;
  const toggle = (slugToTool: string, on: boolean) => {
    const next = new Set(detail.tools.filter((t) => t.enabled).map((t) => t.slug));
    if (on) next.add(slugToTool);
    else next.delete(slugToTool);
    save.mutate([...next]);
  };

  return (
    <section className={styles.block} aria-labelledby="apps-tools">
      <div className={styles.blockBar}>
        <h4 id="apps-tools" className={styles.blockHead}>
          Tools{" "}
          <span className={styles.num}>
            {detail.enabledCount}/{detail.tools.length}
          </span>{" "}
          <span className={styles.muted}>enabled</span>
        </h4>
        {detail.customized && (
          <Button size="sm" variant="ghost" onClick={() => save.mutate(null)}>
            Reset to read-only
          </Button>
        )}
      </div>
      <p className={styles.muted}>
        <ShieldCheck size={13} aria-hidden className={styles.inlineIcon} /> By default only read tools are on. Write tools, when enabled, always stop for your approval before they run.
      </p>
      {detail.tools.length > 8 && (
        <input
          className={styles.toolFilter}
          type="search"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setShown(TOOL_STEP);
          }}
          placeholder={`Filter ${detail.tools.length} tools`}
          aria-label="Filter tools"
        />
      )}
      {detail.tools.length === 0 ? (
        <p className={styles.muted}>No tools listed for this app.</p>
      ) : (
        <ul className={styles.list}>
          {rows.slice(0, shown).map((t) => (
            <li key={t.slug} className={styles.item}>
              <div className={styles.itemBody}>
                <span className={styles.itemName}>
                  {t.name}
                  <span className={t.readOnly ? styles.badge : styles.badgeWarn}>{t.readOnly ? "read" : "write"}</span>
                  {t.needsApproval && <span className={styles.badgeWarn}>needs approval</span>}
                </span>
                <span className={styles.itemDesc}>{t.description || t.slug}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={t.enabled}
                aria-label={`${t.enabled ? "Disable" : "Enable"} ${t.name}`}
                className={styles.switch}
                onClick={() => toggle(t.slug, !t.enabled)}
              />
            </li>
          ))}
          {rows.length === 0 && <li className={styles.muted}>No tools match.</li>}
        </ul>
      )}
      {rows.length > shown && (
        <Button size="sm" variant="ghost" onClick={() => setShown(shown + TOOL_STEP)}>
          Show more ({rows.length - shown} left)
        </Button>
      )}
    </section>
  );
}

function Information({ detail, account, updatedAt }: { detail: ToolkitDetail; account: ReturnType<ReturnType<typeof useApps>["stateOf"]>; updatedAt: number }) {
  const tk = detail.toolkit;
  const rows: Array<[string, React.ReactNode]> = [
    ["Auth", tk.noAuth ? "None required" : tk.authSchemes.length ? tk.authSchemes.map((s) => s.replace(/_/g, " ").toLowerCase()).join(", ") : "—"],
    [
      "Managed auth",
      tk.noAuth ? (
        "Not needed"
      ) : tk.managedAuth ? (
        "Available: Composio hosts the OAuth app"
      ) : (
        <>
          Not available: needs your own developer app
          {tk.authGuideUrl && (
            <>
              {" "}
              <a href={tk.authGuideUrl} target="_blank" rel="noopener noreferrer" className={styles.link}>
                Setup guide <ArrowUpRight size={12} aria-hidden />
              </a>
            </>
          )}
        </>
      ),
    ],
    ["Tools", String(detail.tools.length || tk.toolsCount)],
    ["Triggers", String(detail.triggers.length || tk.triggersCount)],
    ["Categories", tk.categories.map(prettyCategory).join(", ") || "—"],
    [
      "Connected account",
      account ? (
        <>
          <span className={account.status === "ACTIVE" ? styles.okChip : styles.badgeWarn}>{account.status === "ACTIVE" ? "Connected" : account.status === "PENDING" ? "Waiting" : "Needs authentication"}</span>{" "}
          <code className={styles.mono}>{maskId(account.account.id)}</code>
        </>
      ) : (
        "Not connected"
      ),
    ],
    ["Last checked", updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—"],
  ];
  return (
    <section className={styles.block} aria-labelledby="apps-info">
      <h4 id="apps-info" className={styles.blockHead}>
        Information
      </h4>
      <dl className={styles.info}>
        {rows.map(([k, v]) => (
          <div key={k} className={styles.infoRow}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
