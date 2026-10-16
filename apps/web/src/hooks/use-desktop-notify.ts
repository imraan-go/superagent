"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { NotifyEvent } from "@/lib/prefs";
import { useNotificationPrefs } from "./use-prefs";

/**
 * Chrome notifications for when the tab is in the background
 * (DESIGN_SYSTEM §Notifications). Permission is only ever requested from a
 * user gesture (`enable()`), never on load. Clicking a notification focuses
 * the tab and deep-links to the item.
 */
const OPT_IN_KEY = "fd.notify.optin";

type Permission = NotificationPermission | "unsupported";

const listeners = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function permission(): Permission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}
function optedIn(): boolean {
  try {
    return localStorage.getItem(OPT_IN_KEY) === "1";
  } catch {
    return false;
  }
}

export function useDesktopNotify() {
  const prefs = useNotificationPrefs();
  const router = useRouter();
  const perm = useSyncExternalStore(subscribe, permission, () => "unsupported" as Permission);
  const local = useSyncExternalStore(subscribe, optedIn, () => false);

  /** Call from a click handler only. */
  const enable = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    try {
      if (result === "granted") localStorage.setItem(OPT_IN_KEY, "1");
    } catch {
      // Storage blocked: permission still applies for this session.
    }
    for (const l of listeners) l();
  }, []);

  const notify = useCallback(
    (event: NotifyEvent, title: string, body: string, href?: string) => {
      if (permission() !== "granted") return;
      if (!(prefs.chrome || optedIn())) return;
      if (!prefs.events.includes(event)) return;
      // Only when the owner is not looking — in-tab toasts cover the rest.
      if (!document.hidden && document.hasFocus()) return;

      try {
        const n = new Notification(title, { body, tag: `fd-${event}-${href ?? ""}` });
        n.onclick = () => {
          window.focus();
          if (href) router.push(href);
          n.close();
        };
      } catch {
        // Some platforms only allow notifications from a service worker.
      }
    },
    [prefs, router],
  );

  return {
    notify,
    enable,
    permission: perm,
    enabled: perm === "granted" && (prefs.chrome || local),
  };
}
