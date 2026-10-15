"use client";

import { useSyncExternalStore } from "react";

/**
 * Tracks `prefers-reduced-motion`. Tokens already zero out CSS durations, but
 * JS-driven motion (count-ups, the LiveGlyph orbit, the splash sequence) has to
 * opt out explicitly.
 *
 * `matchMedia` is an external store, so it is read through
 * `useSyncExternalStore` — no effect, and no hydration mismatch.
 */
const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

/** The server cannot know the preference; CSS handles it until hydration. */
function getServerSnapshot(): boolean {
  return false;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
