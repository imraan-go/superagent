"use client";

import { Moon, Sun } from "@phosphor-icons/react/dist/ssr";
import { IconButton } from "@/components/ui";
import { setTheme } from "@/lib/theme";
import styles from "./theme-toggle.module.css";

/**
 * Compact topbar control. The icon is CSS-swapped from `data-theme` so the
 * first paint matches ThemeScript and never hydrates the wrong glyph.
 */
export function ThemeToggle() {
  return (
    <IconButton
      label="Toggle theme"
      icon={
        <span className={styles.icons} aria-hidden>
          <Sun size={16} weight="duotone" className={styles.sun} />
          <Moon size={16} weight="duotone" className={styles.moon} />
        </span>
      }
      onClick={() => {
        const next =
          document.documentElement.dataset.theme === "light" ? "dark" : "light";
        setTheme(next);
      }}
    />
  );
}
