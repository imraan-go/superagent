"use client";

import { ArrowsClockwise, Check, Hourglass } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { AppLogo } from "./app-logo";
import { useApps } from "./apps-context";
import styles from "./apps.module.css";

export interface RowApp {
  slug: string;
  name: string;
  description: string;
  /** False when the agent has no verified tools for this app yet (browse-only). */
  pinned?: boolean;
}

/** Connect / Connected / Waiting / Authenticate: the one action button every list and the detail view share. */
export function AppAction({ app, size = "sm", onOpen }: { app: RowApp; size?: "sm" | "md"; onOpen?: () => void }) {
  const { stateOf, connect, connecting, openApp } = useApps();
  const st = stateOf(app.slug);
  const busy = connecting === app.slug;
  if (st?.status === "ACTIVE") {
    return (
      <Button size={size} variant="ghost" className={styles.connectedBtn} iconLeft={<Check size={14} weight="bold" aria-hidden />} onClick={onOpen ?? (() => openApp(app.slug))} aria-label={`${app.name} is connected. Open details`}>
        Connected
      </Button>
    );
  }
  if (st?.status === "PENDING") {
    return (
      <Button size={size} variant="secondary" disabled iconLeft={<Hourglass size={14} aria-hidden />}>
        Waiting…
      </Button>
    );
  }
  if (st?.status === "EXPIRED") {
    return (
      <Button size={size} variant="attention" loading={busy} iconLeft={<ArrowsClockwise size={14} aria-hidden />} onClick={() => connect(app.slug, app.name)} aria-label={`Authenticate ${app.name} again`}>
        Authenticate
      </Button>
    );
  }
  if (app.pinned === false) {
    return (
      <Button size={size} variant="ghost" disabled title="The agent has no verified tools for this app yet" aria-label={`${app.name}: not available yet`}>
        Not yet
      </Button>
    );
  }
  return (
    <Button size={size} variant="outline" loading={busy} onClick={() => connect(app.slug, app.name)} aria-label={`Connect ${app.name}`}>
      Connect
    </Button>
  );
}

/** One catalog row: logo tile, name, one-line description, action. The main area opens the detail view. */
export function AppRow({ app, style, className }: { app: RowApp; style?: React.CSSProperties; className?: string }) {
  const { openApp } = useApps();
  return (
    <div className={cn(styles.row, className)} style={style}>
      <button type="button" className={styles.rowMain} data-app-main onClick={() => openApp(app.slug)} aria-label={`${app.name}: ${app.description || "details"}`}>
        <AppLogo slug={app.slug} name={app.name} size={40} />
        <span className={styles.rowText}>
          <span className={styles.rowName}>{app.name}</span>
          <span className={styles.rowDesc}>{app.description || app.slug}</span>
        </span>
      </button>
      <span className={styles.rowAction}>
        <AppAction app={app} />
      </span>
    </div>
  );
}

export function RowSkeleton({ style }: { style?: React.CSSProperties }) {
  return (
    <div className={cn(styles.row, styles.rowSkel)} style={style} aria-hidden>
      <span className={styles.skelLogo} />
      <span className={styles.skelLines}>
        <span />
        <span />
      </span>
    </div>
  );
}
