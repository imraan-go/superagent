"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDots, Lightning, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { api } from "@/components/settings/tabs/shared";
import { Button, SkeletonText } from "@/components/ui";
import { openSettings } from "@/lib/app-events";
import { COMPOSIO_STATUS_KEY } from "@/lib/composio-types";
import type { InstalledApp } from "@/lib/composio-types";
import { AppLogo } from "./app-logo";
import { AppAction } from "./app-row";
import { useApps } from "./apps-context";
import styles from "./apps.module.css";

const FIRST = 6;

function toolSummary(app: InstalledApp): string {
  const c = `${app.accounts} connector${app.accounts === 1 ? "" : "s"}`;
  if (app.status !== "ACTIVE") return app.status === "PENDING" ? "Waiting for authorisation" : "Needs authentication";
  return app.enabledCount === null ? c : `${c}, ${app.enabledCount} tool${app.enabledCount === 1 ? "" : "s"} enabled`;
}

export function AppsManage({ onClose }: { onClose: () => void }) {
  const apps = useApps();
  const [all, setAll] = useState(false);
  const q = useQuery({
    queryKey: [...COMPOSIO_STATUS_KEY, "installed"],
    queryFn: () => api<{ apps: InstalledApp[] }>("/api/connectors/composio/installed"),
    staleTime: 15_000,
  });
  // Statuses come from the shared (polling) query so a finished OAuth flips here without a reload.
  const list = (q.data?.apps ?? []).map((a) => {
    const live = apps.stateOf(a.toolkit);
    return live ? { ...a, status: live.status, accountId: live.account.id } : a;
  });
  const visible = all ? list : list.slice(0, FIRST);

  return (
    <div className={styles.manage}>
      <section className={styles.block} aria-labelledby="apps-installed">
        <h3 id="apps-installed" className={styles.sectionHead}>
          Installed <span className={styles.num}>{list.length}</span>
        </h3>
        {q.isPending ? (
          <SkeletonText lines={4} />
        ) : q.error ? (
          <div role="alert">
            <p className={styles.err}>{q.error.message}</p>
            <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
              Try again
            </Button>
          </div>
        ) : list.length === 0 ? (
          <p className={styles.empty}>No apps connected yet. Browse the catalog and press Connect.</p>
        ) : (
          <>
            <div className={styles.grid} role="list">
              {visible.map((a) => (
                <div key={a.toolkit} role="listitem" className={styles.gridCell}>
                  <div className={styles.row}>
                    <button type="button" className={styles.rowMain} data-app-main onClick={() => apps.openApp(a.toolkit)} aria-label={`${a.name}: ${toolSummary(a)}`}>
                      <AppLogo slug={a.toolkit} name={a.name} size={40} />
                      <span className={styles.rowText}>
                        <span className={styles.rowName}>{a.name}</span>
                        <span className={styles.rowDesc} data-status={a.status}>
                          {toolSummary(a)}
                        </span>
                      </span>
                    </button>
                    <span className={styles.rowAction}>
                      <AppAction app={{ slug: a.toolkit, name: a.name, description: a.description }} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {list.length > FIRST && (
              <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>
                {all ? "Show fewer" : `Show all ${list.length}`}
              </Button>
            )}
          </>
        )}
      </section>

      <section className={styles.block} aria-labelledby="apps-skills">
        <h3 id="apps-skills" className={styles.sectionHead}>
          Skills and automations
        </h3>
        <p className={styles.muted}>
          Connected apps feed LHOS workflows. Saved workflows run on a schedule or when a trigger or webhook fires.
        </p>
        <div className={styles.linkCards}>
          <button type="button" className={styles.linkCard} onClick={() => { onClose(); openSettings("schedules"); }}>
            <CalendarDots size={20} weight="duotone" aria-hidden />
            <span>
              <strong>Schedules</strong>
              <small>Run a saved workflow on a timetable</small>
            </span>
          </button>
          <button type="button" className={styles.linkCard} onClick={() => { onClose(); openSettings("triggers"); }}>
            <Lightning size={20} weight="duotone" aria-hidden />
            <span>
              <strong>Triggers and webhooks</strong>
              <small>Start a run from an app event</small>
            </span>
          </button>
          <button type="button" className={styles.linkCard} onClick={() => { onClose(); openSettings("connectors"); }}>
            <Sparkle size={20} weight="duotone" aria-hidden />
            <span>
              <strong>Connector settings</strong>
              <small>MCP, REST and Composio options</small>
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}
