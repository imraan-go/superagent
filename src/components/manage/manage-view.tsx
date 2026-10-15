"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  ChartLine,
  Camera,
  CalendarCheck,
  Desktop,
  FolderOpen,
  Gear,
  HandPalm,
  Terminal,
} from "@phosphor-icons/react/dist/ssr";
import { Skeleton, SkeletonText, ToastProvider } from "@/components/ui";
import { cn } from "@/lib/cn";
import styles from "./manage-view.module.css";

/** Section-shaped placeholder: heading, a line of copy, then a card grid. */
function SectionSkeleton() {
  return (
    <div role="status" aria-label="Loading section" className={styles.sectionSkeleton}>
      <Skeleton shape="text" width="30%" height={24} />
      <SkeletonText lines={2} />
      <div className={styles.sectionSkeletonGrid}>
        <Skeleton shape="panel" height={140} />
        <Skeleton shape="panel" height={140} />
        <Skeleton shape="panel" height={140} />
        <Skeleton shape="panel" height={140} />
      </div>
    </div>
  );
}

/** Every section is its own chunk; Manage opens on Overview and loads the rest on demand. */
const Overview = dynamic(() => import("./overview").then((m) => m.Overview), { loading: SectionSkeleton });
const Activity = dynamic(() => import("./activity").then((m) => m.Activity), { loading: SectionSkeleton });
const Persist = dynamic(() => import("./persist").then((m) => m.Persist), { loading: SectionSkeleton });
const Snapshots = dynamic(() => import("./storage").then((m) => m.Snapshots), { loading: SectionSkeleton });
const Schedules = dynamic(() => import("./storage").then((m) => m.Schedules), { loading: SectionSkeleton });
const System = dynamic(() => import("./system").then((m) => m.System), { loading: SectionSkeleton });
const Logs = dynamic(() => import("./logs").then((m) => m.Logs), { loading: SectionSkeleton });
const Hitl = dynamic(() => import("./hitl").then((m) => m.Hitl), { loading: SectionSkeleton });

/**
 * Manage workspace: a left rail of sections over the host bridge and the LHOS
 * agent server. Every mutating action is hold-to-confirm and audited.
 */
type Section = "overview" | "activity" | "persist" | "snapshots" | "schedules" | "system" | "logs" | "hitl";

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Desktop }> = [
  { id: "overview", label: "Overview", icon: Desktop },
  { id: "activity", label: "Activity & reports", icon: ChartLine },
  { id: "persist", label: "Persistent data", icon: FolderOpen },
  { id: "snapshots", label: "Snapshots", icon: Camera },
  { id: "schedules", label: "Schedules", icon: CalendarCheck },
  { id: "system", label: "System", icon: Gear },
  { id: "logs", label: "Logs", icon: Terminal },
  { id: "hitl", label: "HITL inbox", icon: HandPalm },
];

export function ManageView() {
  const [section, setSection] = useState<Section>("overview");

  // `/manage?section=hitl` is the deep link behind the topbar waiting badge.
  const requested = useSearchParams().get("section");
  const [seenRequest, setSeenRequest] = useState<string | null>(null);
  if (requested !== seenRequest) {
    setSeenRequest(requested);
    const match = SECTIONS.find((s) => s.id === requested);
    if (match) setSection(match.id);
  }

  return (
    <ToastProvider>
      <div className={styles.root}>
        <nav className={styles.nav} aria-label="Manage sections">
          <p className={styles.navLabel}>System</p>
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={cn(styles.navItem, section === item.id && styles.navItemActive)}
                aria-current={section === item.id ? "page" : undefined}
                onClick={() => setSection(item.id)}
              >
                <Icon size={16} weight={section === item.id ? "fill" : "regular"} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <main id="main" tabIndex={-1} className={styles.main}>
          {section === "overview" && <Overview />}
          {section === "activity" && <Activity />}
          {section === "persist" && <Persist />}
          {section === "snapshots" && <Snapshots />}
          {section === "schedules" && <Schedules />}
          {section === "system" && <System />}
          {section === "logs" && <Logs />}
          {section === "hitl" && <Hitl />}
        </main>
      </div>
    </ToastProvider>
  );
}
