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
import { Modal } from "@/components/ui";
import { cn } from "@/lib/cn";
import styles from "./settings-modal.module.css";
import { AgentTab } from "./tabs/agent-tab";
import { AppearanceSync, AppearanceTab } from "./tabs/appearance-tab";
import { ApprovalsTab } from "./tabs/approvals-tab";
import { DangerTab } from "./tabs/danger-tab";
import { DataTab } from "./tabs/data-tab";
import { ModelsTab } from "./tabs/models-tab";
import { NotificationsTab } from "./tabs/notifications-tab";
import { UsageTab } from "./tabs/usage-tab";
import { SchedulesTab } from "./tabs/schedules-tab";
import { TriggersTab } from "./tabs/triggers-tab";
import { ConnectorsTab } from "./tabs/connectors-tab";
import { MemoriesTab } from "./tabs/memories-tab";

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

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<string>(TABS[0]!.id);
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
