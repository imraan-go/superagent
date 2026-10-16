"use client";

import { useEffect, useSyncExternalStore } from "react";
import { LiveGlyph, Readout } from "@/components/ui";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import styles from "./splash.module.css";

/**
 * Plays once per browser session, immediately after login. The login form sets
 * `sessionStorage['fd.splash'] = 'pending'`; this component consumes that flag,
 * so a refresh or an in-app navigation never replays it.
 *
 * Skipped entirely under `prefers-reduced-motion`.
 *
 * The flag is read through `useSyncExternalStore` rather than an effect:
 * sessionStorage is external state, and `getServerSnapshot` keeps the server
 * and hydration renders in agreement.
 */
const TOTAL_MS = 1600;
const KEY = "fd.splash";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "pending";
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  return false;
}

function dismiss(): void {
  try {
    sessionStorage.setItem(KEY, "done");
  } catch {
    // Private-mode storage failure just means the splash does not replay.
  }
  for (const listener of listeners) listener();
}

export function Splash() {
  const pending = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const reduced = useReducedMotion();
  const visible = pending && !reduced;

  useEffect(() => {
    if (!pending) return;
    if (reduced) {
      dismiss();
      return;
    }
    const id = setTimeout(dismiss, TOTAL_MS);
    return () => clearTimeout(id);
  }, [pending, reduced]);

  if (!visible) return null;

  return (
    <div className={styles.overlay} role="status" aria-label="Starting Superagent">
      <div className={styles.inner}>
        <div className={styles.glyph}>
          <LiveGlyph state="thinking" size={96} label="" />
        </div>
        <div className={styles.wordmark}>Superagent</div>
        <div className={styles.readouts}>
          {/* Self-test: the readouts count up as the panel wakes. */}
          <div className={styles.readout}>
            <Readout label="link" value="online" size="sm" tone="signal" />
          </div>
          <div className={styles.readout}>
            <Readout label="tools" value={100} size="sm" />
          </div>
          <div className={styles.readout}>
            <Readout label="desktop" value="READY" size="sm" tone="ok" />
          </div>
        </div>
      </div>
      <button type="button" className={styles.skip} onClick={dismiss}>
        Skip
      </button>
    </div>
  );
}
