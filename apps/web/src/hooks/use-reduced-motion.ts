'use client';

import { useSyncExternalStore } from 'react';

/**
 * Tracks reduced motion: the OS `prefers-reduced-motion` query, overridden by
 * Settings › Appearance (`data-motion="reduce" | "full"` on <html>). Tokens
 * already zero out CSS durations, but JS-driven motion (count-ups, Motion
 * springs, the splash sequence) has to opt out explicitly.
 */
const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  return () => {
    mq.removeEventListener('change', onChange);
    mo.disconnect();
  };
}

function getSnapshot(): boolean {
  const forced = document.documentElement.dataset.motion;
  if (forced === 'reduce') return true;
  if (forced === 'full') return false;
  return window.matchMedia(QUERY).matches;
}

/** The server cannot know the preference; CSS handles it until hydration. */
function getServerSnapshot(): boolean {
  return false;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
