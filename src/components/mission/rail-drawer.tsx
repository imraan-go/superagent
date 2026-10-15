"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { SlidersHorizontal, X } from "@phosphor-icons/react/dist/ssr";
import { IconButton } from "@/components/ui";
import { usePending } from "@/hooks/use-pending";
import { OPEN_COMPUTER_EVENT } from "@/lib/hitl";
import styles from "./rail-drawer.module.css";

const TOGGLE_ID = "mission-rail-toggle";
const CLOSE_ID = "mission-rail-close";

/**
 * Below 1100px the Mission rail becomes a right-hand drawer, so approvals and
 * the Computer stay reachable on a phone. State, focus handoff (in on open,
 * back to the toggle on close), Esc, and "Open computer" requests live here so
 * every route that shows the rail behaves the same.
 */
export function useRailDrawer() {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    document.getElementById(TOGGLE_ID)?.focus();
  }, []);

  useEffect(() => {
    if (open) document.getElementById(CLOSE_ID)?.focus();
  }, [open]);

  // A takeover request ("Open computer") must reach the screen on narrow widths too.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_COMPUTER_EVENT, show);
    return () => window.removeEventListener(OPEN_COMPUTER_EVENT, show);
  }, []);

  return { open, setOpen, close };
}

export type RailDrawer = ReturnType<typeof useRailDrawer>;

/** Floating toggle, shown only on narrow widths; carries the waiting count. */
export function RailToggle({ drawer }: { drawer: RailDrawer }) {
  const { data } = usePending();
  const waiting = data?.count ?? 0;

  return (
    <button
      id={TOGGLE_ID}
      type="button"
      className={styles.toggle}
      aria-expanded={drawer.open}
      aria-controls="mission-rail"
      onClick={() => drawer.setOpen((v) => !v)}
    >
      <SlidersHorizontal size={16} weight="duotone" aria-hidden />
      <span>Mission</span>
      {waiting > 0 && (
        <span className={styles.toggleCount} aria-label={`${waiting} waiting on you`}>
          {waiting}
        </span>
      )}
    </button>
  );
}

export function RailAside({ drawer, children }: { drawer: RailDrawer; children: ReactNode }) {
  return (
    <>
      {drawer.open && <div className={styles.scrim} aria-hidden onClick={drawer.close} />}
      <aside
        id="mission-rail"
        className={styles.rail}
        data-open={drawer.open || undefined}
        aria-label="Mission panel"
        onKeyDown={(e) => {
          if (e.key === "Escape" && drawer.open) drawer.close();
        }}
      >
        <IconButton
          id={CLOSE_ID}
          label="Close Mission panel"
          icon={<X size={16} weight="bold" />}
          className={styles.close}
          onClick={drawer.close}
        />
        {children}
      </aside>
    </>
  );
}
