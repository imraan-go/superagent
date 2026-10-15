"use client";

import { useState } from "react";
import {
  Bell,
  Brain,
  CalendarDots,
  Desktop,
  Lightning,
  PlugsConnected,
  Gear,
  HardDrives,
  Palette,
  Robot,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr";
import { Modal, SegmentedSwitch, SettingRow, SettingSection } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import type { ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/cn";
import styles from "./settings-modal.module.css";
import { SchedulesTab } from "./tabs/schedules-tab";
import { TriggersTab } from "./tabs/triggers-tab";
import { ConnectorsTab } from "./tabs/connectors-tab";
import { MemoriesTab } from "./tabs/memories-tab";

/**
 * Settings shell. The left rail and SettingRow layout come from the Grok Bot
 * reference; only Appearance is wired today. Other tabs stay as honest
 * placeholders so the owner can see the map without a half-built form.
 */
type Tab =
  | "appearance"
  | "models"
  | "agent"
  | "computer"
  | "notifications"
  | "data"
  | "schedules"
  | "triggers"
  | "connectors"
  | "memories";

const TABS: Array<{
  id: Tab;
  label: string;
  icon: typeof Palette;
  render?: () => React.ReactNode;
}> = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "models", label: "Models", icon: Sparkle },
  { id: "agent", label: "Agent", icon: Robot },
  { id: "computer", label: "Computer", icon: Desktop },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "data", label: "Data", icon: HardDrives },
  { id: "schedules", label: "Schedules", icon: CalendarDots, render: () => <SchedulesTab /> },
  { id: "triggers", label: "Triggers & Webhooks", icon: Lightning, render: () => <TriggersTab /> },
  { id: "connectors", label: "Connectors", icon: PlugsConnected, render: () => <ConnectorsTab /> },
  { id: "memories", label: "Memories", icon: Brain, render: () => <MemoriesTab /> },
];

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("appearance");
  const active = TABS.find((t) => t.id === tab) ?? TABS[0]!;

  return (
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
            return (
              <button
                key={item.id}
                type="button"
                className={cn(styles.navItem, tab === item.id && styles.navItemActive)}
                aria-current={tab === item.id ? "page" : undefined}
                onClick={() => setTab(item.id)}
              >
                <Icon size={16} weight={tab === item.id ? "fill" : "regular"} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className={styles.content}>
          {tab === "appearance" ? (
            <AppearanceTab />
          ) : active.render ? (
            active.render()
          ) : (
            <ComingSoon title={active.label} />
          )}
        </div>
      </div>
    </Modal>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme();

  return (
    <SettingSection title="Appearance">
      <SettingRow
        label="Theme"
        description="Follow the system, or lock the deck to ink or paper."
      >
        <SegmentedSwitch<ThemePreference>
          label="Theme"
          size="sm"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
            { value: "system", label: "System" },
          ]}
        />
      </SettingRow>
    </SettingSection>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <SettingSection title={title}>
      <SettingRow
        label={`${title} arrives in a later phase`}
        description="The layout is fixed so this tab will fill in without a redesign."
      >
        <span className={styles.soon}>Soon</span>
      </SettingRow>
    </SettingSection>
  );
}
