"use client";

import { useState } from "react";
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
import { ToastProvider } from "@/components/ui";
import { cn } from "@/lib/cn";
import { Activity } from "./activity";
import { Hitl } from "./hitl";
import { Logs } from "./logs";
import { Overview } from "./overview";
import { Persist } from "./persist";
import { Schedules, Snapshots } from "./storage";
import { System } from "./system";
import styles from "./manage-view.module.css";

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

        <main className={styles.main}>
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
