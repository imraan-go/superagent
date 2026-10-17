/**
 * Tiny window-event bus so the command palette / hotkeys can drive UI that
 * owns its own state (Settings tab, Manage section) without lifting that
 * state into a global store.
 */
export const OPEN_SETTINGS_EVENT = "fd:open-settings";
export const MANAGE_SECTION_EVENT = "fd:manage-section";

export interface OpenSettingsDetail {
  tab?: string;
}

export function openSettings(tab?: string): void {
  window.dispatchEvent(new CustomEvent<OpenSettingsDetail>(OPEN_SETTINGS_EVENT, { detail: { tab } }));
}

let pendingManageSection: string | null = null;

/** Select a Manage section; survives the route change if Manage is not mounted yet. */
export function requestManageSection(id: string): void {
  pendingManageSection = id;
  window.dispatchEvent(new CustomEvent<string>(MANAGE_SECTION_EVENT, { detail: id }));
}

export function consumePendingManageSection(): string | null {
  const id = pendingManageSection;
  pendingManageSection = null;
  return id;
}

export function focusPrompt(): boolean {
  const el = document.querySelector<HTMLElement>("[data-prompt-input]");
  if (!el || (el as HTMLTextAreaElement).disabled) return false;
  el.focus();
  return true;
}

/** Move focus to the first "Waiting on you" card. */
export function focusWaitingCard(): boolean {
  const el = document.querySelector<HTMLElement>("[data-waiting-card]");
  if (!el) return false;
  el.focus();
  return true;
}

/** Connect Apps modal (Composio catalog). Anything can open it, optionally at one app or the Manage view. */
export const OPEN_APPS_EVENT = "fd:open-apps";

export interface OpenAppsDetail {
  /** Composio toolkit slug to open straight to its detail view. */
  app?: string;
  view?: "browse" | "manage";
}

export function openApps(detail: OpenAppsDetail = {}): void {
  window.dispatchEvent(new CustomEvent<OpenAppsDetail>(OPEN_APPS_EVENT, { detail }));
}
