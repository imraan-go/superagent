"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Tiny persisted boolean layout preferences (left rail collapsed, right rail
 * minimised). localStorage-backed, shared across components through an
 * in-memory event, and read via useSyncExternalStore so there is no
 * setState-in-effect and no hydration mismatch (the server renders `false`).
 */
const EVENT = "fd:ui-pref";

export const PREF_LEFT_COLLAPSED = "fd.layout.leftCollapsed";
export const PREF_RIGHT_MINIMIZED = "fd.layout.rightMinimized";

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function setPref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // private mode / blocked storage — the toggle still works for this page view
  }
  memory.set(key, value);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

const memory = new Map<string, boolean>();

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function usePref(key: string): [boolean, (next: boolean | ((v: boolean) => boolean)) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => memory.get(key) ?? read(key),
    () => false,
  );
  const set = useCallback(
    (next: boolean | ((v: boolean) => boolean)) => {
      const current = memory.get(key) ?? read(key);
      setPref(key, typeof next === "function" ? next(current) : next);
    },
    [key],
  );
  return [value, set];
}
