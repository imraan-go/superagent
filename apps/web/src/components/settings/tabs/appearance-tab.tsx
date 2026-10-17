"use client";

import { useEffect } from "react";
import { SegmentedSwitch, SettingRow, SettingSection } from "@/components/ui";
import { useSettingsSection } from "@/hooks/use-settings";
import { useTheme } from "@/hooks/use-theme";
import type { AppearanceSettings } from "@/lib/settings";
import type { ThemePreference } from "@/lib/theme";
import { InlineError } from "../controls";

/** Mirrors motion/density onto `<html>`; tokens.css reacts to the attributes. */
export function applyAppearance(v: Pick<AppearanceSettings, "reducedMotion" | "density">): void {
  const root = document.documentElement;
  if (v.reducedMotion === "on") root.dataset.motion = "reduce";
  else if (v.reducedMotion === "off") root.dataset.motion = "full";
  else delete root.dataset.motion;
  root.dataset.density = v.density;
}

/**
 * Mounted once by the Settings modal (which is always in the tree), so stored
 * motion/density apply on every page load, not only after opening Settings.
 */
export function AppearanceSync() {
  const { value, loaded } = useSettingsSection("appearance");
  useEffect(() => {
    if (loaded) applyAppearance(value);
  }, [loaded, value]);
  return null;
}

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const appearance = useSettingsSection("appearance");
  const v = appearance.value;

  return (
    <SettingSection title="Appearance">
      <SettingRow label="Theme" description="Follow the system, or lock the deck to ink or paper.">
        <SegmentedSwitch<ThemePreference>
          label="Theme"
          size="sm"
          value={theme}
          onChange={(next) => {
            // localStorage stays the paint-time source (no flash); the
            // settings row makes it follow the owner across browsers.
            setTheme(next);
            void appearance.save({ theme: next });
          }}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
            { value: "system", label: "System" },
          ]}
        />
      </SettingRow>
      <SettingRow label="Reduced motion" description="System follows your OS setting.">
        <SegmentedSwitch<AppearanceSettings["reducedMotion"]>
          label="Reduced motion"
          size="sm"
          value={v.reducedMotion}
          onChange={(reducedMotion) => {
            applyAppearance({ ...v, reducedMotion });
            void appearance.save({ reducedMotion });
          }}
          options={[
            { value: "system", label: "System" },
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
      </SettingRow>
      <SettingRow label="Density" description="Compact tightens spacing across the deck.">
        <SegmentedSwitch<AppearanceSettings["density"]>
          label="Density"
          size="sm"
          value={v.density}
          onChange={(density) => {
            applyAppearance({ ...v, density });
            void appearance.save({ density });
          }}
          options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]}
        />
      </SettingRow>
      <InlineError error={appearance.error} />
    </SettingSection>
  );
}
