"use client";

import { useState } from "react";
import type { ComponentType } from "react";
import {
  ChartBar,
  Brain,
  CalendarDots,
  Lightning,
  PlugsConnected,
  Gear,
  HardDrives,
  Palette,
  Robot,
  ShieldCheck,
  SpeakerHigh,
  Sparkle,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import dynamic from "next/dynamic";
import { Modal, SkeletonText } from "@/components/ui";
import { cn } from "@/lib/cn";
import styles from "./settings-modal.module.css";
// Appearance stays static: AppearanceSync must run on every page load.
import { AppearanceSync, AppearanceTab } from "./tabs/appearance-tab";

/** Each tab is its own chunk: opening Settings loads only the tab being read. */
function lazyTab(load: () => Promise<ComponentType>) {
  return dynamic(load, {
    loading: () => (
      <div className={styles.tabFallback} role="status" aria-label="Loading">
        <SkeletonText lines={2} />
        <SkeletonText lines={4} />
      </div>
    ),
  });
}

const AgentTab = lazyTab(() => import("./tabs/agent-tab").then((m) => m.AgentTab));
const ApprovalsTab = lazyTab(() => import("./tabs/approvals-tab").then((m) => m.ApprovalsTab));
const DangerTab = lazyTab(() => import("./tabs/danger-tab").then((m) => m.DangerTab));
const DataTab = lazyTab(() => import("./tabs/data-tab").then((m) => m.DataTab));
const ModelsTab = lazyTab(() => import("./tabs/models-tab").then((m) => m.ModelsTab));
const NotificationsTab = lazyTab(() => import("./tabs/notifications-tab").then((m) => m.NotificationsTab));
const UsageTab = lazyTab(() => import("./tabs/usage-tab").then((m) => m.UsageTab));
const SchedulesTab = lazyTab(() => import("./tabs/schedules-tab").then((m) => m.SchedulesTab));
const TriggersTab = lazyTab(() => import("./tabs/triggers-tab").then((m) => m.TriggersTab));
const ConnectorsTab = lazyTab(() => import("./tabs/connectors-tab").then((m) => m.ConnectorsTab));
const MemoriesTab = lazyTab(() => import("./tabs/memories-tab").then((m) => m.MemoriesTab));

/**
 * Settings: left rail + one component per tab. Each tab owns its data
 * (react-query, keyed `["settings", <section>]`), so adding a tab is one entry
 * in `TABS` and one file under `./tabs`.
 */
interface SettingsTab {
  id: string;
  label: string;
  icon: typeof Palette;
  Component: ComponentType;
}

const TABS: SettingsTab[] = [
  { id: "models", label: "Models", icon: Sparkle, Component: ModelsTab },
  { id: "usage", label: "Usage", icon: ChartBar, Component: UsageTab },
  { id: "agent", label: "Agent", icon: Robot, Component: AgentTab },
  { id: "approvals", label: "Approvals & Takeover", icon: ShieldCheck, Component: ApprovalsTab },
  { id: "schedules", label: "Schedules", icon: CalendarDots, Component: SchedulesTab },
  { id: "triggers", label: "Triggers & Webhooks", icon: Lightning, Component: TriggersTab },
  { id: "connectors", label: "Connectors", icon: PlugsConnected, Component: ConnectorsTab },
  { id: "memories", label: "Memories", icon: Brain, Component: MemoriesTab },
  { id: "appearance", label: "Appearance", icon: Palette, Component: AppearanceTab },
  { id: "notifications", label: "Notifications & Sound", icon: SpeakerHigh, Component: NotificationsTab },
  { id: "data", label: "Data", icon: HardDrives, Component: DataTab },
  { id: "danger", label: "Danger zone", icon: Warning, Component: DangerTab },
];

/** Tab ids + labels for the command palette ("Settings: Models"). */
export const SETTINGS_TAB_LIST = TABS.map(({ id, label }) => ({ id, label }));

export function SettingsModal({
  open,
  onClose,
  requestedTab,
}: {
  open: boolean;
  onClose: () => void;
  /** Deep-link: select this tab whenever Settings opens (palette, shortcuts). */
  requestedTab?: string;
}) {
  const [tab, setTab] = useState<string>(TABS[0]!.id);

  // Apply a deep-link on the closed -> open transition (adjust-during-render).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && requestedTab && TABS.some((t) => t.id === requestedTab)) setTab(requestedTab);
  }
  const active = TABS.find((t) => t.id === tab) ?? TABS[0]!;
  const Active = active.Component;

  return (
    <>
      <AppearanceSync />
      <Modal
        open={open}
        onClose={onClose}
        title={
          <span className={styles.title}>
            <Gear size={16} weight="duotone" aria-hidden />
            Settings
          </span>
        }
        wide
        bodyFlush
      >
        <div className={styles.layout}>
          <nav className={styles.nav} aria-label="Settings sections">
            {TABS.map((item) => {
              const Icon = item.icon;
              const selected = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    styles.navItem,
                    selected && styles.navItemActive,
                    item.id === "danger" && styles.navItemDanger,
                  )}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => setTab(item.id)}
                >
                  <Icon size={16} weight={selected ? "fill" : "regular"} aria-hidden />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className={styles.content}>
            {/* Mounted only while open so closed Settings costs no requests. */}
            {open && <Active />}
          </div>
        </div>
      </Modal>
    </>
  );
}
