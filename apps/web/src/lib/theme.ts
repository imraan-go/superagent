/**
 * Appearance theme. The authoritative value is Settings `appearance.theme`,
 * seeded into ThemeScript by the root layout; this localStorage mirror is what
 * the theme store reads between loads.
 */
export type ThemePreference = "dark" | "light" | "system";

export const THEME_KEY = "fd.theme";

const listeners = new Set<() => void>();

export function readTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === "dark" || stored === "light" || stored === "system" ? stored : "system";
}

export function resolvedTheme(preference: ThemePreference): "dark" | "light" {
  if (preference !== "system") return preference;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolvedTheme(preference);
}

export function setTheme(preference: ThemePreference): void {
  window.localStorage.setItem(THEME_KEY, preference);
  applyTheme(preference);
  listeners.forEach((l) => l());
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);

  // System preference changes must re-resolve when the owner picked "system".
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => {
    if (readTheme() === "system") applyTheme("system");
    listener();
  };
  mq.addEventListener("change", onScheme);

  return () => {
    listeners.delete(listener);
    mq.removeEventListener("change", onScheme);
  };
}
