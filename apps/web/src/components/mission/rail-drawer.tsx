"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { CaretDoubleLeft, CaretDoubleRight, SlidersHorizontal, X } from "@phosphor-icons/react/dist/ssr";
import { CategoryTile, CountUp, Dot, IconButton, LiveGlyph } from "@/components/ui";
import type { LiveGlyphState } from "@/components/ui";
import { usePending } from "@/hooks/use-pending";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useCapabilities } from "@/hooks/use-capabilities";
import { WIDE_QUERY, useMedia } from "@/hooks/use-media";
import { useUsageTicker } from "@/hooks/use-usage-ticker";
import type { RunPhase } from "@/hooks/use-run-stream";
import { PREF_RIGHT_MINIMIZED, usePref } from "@/lib/ui-prefs";
import { focusWaitingCard } from "@/lib/app-events";
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

function glyphFor(phase: RunPhase | undefined): LiveGlyphState {
  switch (phase) {
    case "thinking":
      return "thinking";
    case "tool":
    case "waiting":
      return "tool";
    case "approval":
      return "approval";
    case "done":
      return "done";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

/**
 * The right rail. ≥1100px it is a fixed full-height column that can be
 * MINIMISED (⌘.) to a 56px dock of live mini indicators; the choice persists.
 * Below 1100px it is the drawer above, and minimise does not apply.
 */
export function RailAside({
  drawer,
  phase,
  children,
}: {
  drawer: RailDrawer;
  phase?: RunPhase;
  children: ReactNode;
}) {
  const [pref, setMinimized] = usePref(PREF_RIGHT_MINIMIZED);
  const wide = useMedia(WIDE_QUERY);
  const minimized = pref && wide;

  useHotkeys([{ keys: "mod+.", allowInInput: true, handler: () => setMinimized((v) => !v) }]);

  // Anything that needs the full rail (Open computer, Waiting on you) expands it.
  useEffect(() => {
    const expand = () => setMinimized(false);
    window.addEventListener(OPEN_COMPUTER_EVENT, expand);
    return () => window.removeEventListener(OPEN_COMPUTER_EVENT, expand);
  }, [setMinimized]);

  return (
    <>
      {drawer.open && <div className={styles.scrim} aria-hidden onClick={drawer.close} />}
      <aside
        id="mission-rail"
        className={styles.rail}
        data-open={drawer.open || undefined}
        data-minimized={minimized || undefined}
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
        <IconButton
          label="Minimize panel"
          size="sm"
          aria-keyshortcuts="Control+Period Meta+Period"
          icon={<CaretDoubleRight size={14} />}
          className={styles.minimize}
          onClick={() => setMinimized(true)}
        />
        <div className={styles.full} inert={minimized}>
          {children}
        </div>
        {minimized && <MiniDock phase={phase} onExpand={() => setMinimized(false)} />}
      </aside>
    </>
  );
}

/** The minimised rail: live mini indicators, every one of them click-to-expand. */
function MiniDock({ phase, onExpand }: { phase?: RunPhase; onExpand: () => void }) {
  const { data } = usePending();
  const waiting = data?.count ?? 0;
  const { summary, live } = useUsageTicker();
  const { state, dot } = useCapabilities();
  const cost = summary?.today.costUsd ?? null;
  const glyph = glyphFor(phase);

  return (
    <div className={styles.dock}>
      <IconButton
        label="Expand panel"
        aria-keyshortcuts="Control+Period Meta+Period"
        icon={<CaretDoubleLeft size={16} />}
        onClick={onExpand}
      />
      <span className={styles.dockSep} aria-hidden />
      <button type="button" className={styles.dockItem} onClick={onExpand} title="Run state">
        <LiveGlyph state={glyph} size={24} />
      </button>
      <button
        type="button"
        className={styles.dockItem}
        data-tone={waiting > 0 ? "amber" : undefined}
        onClick={() => {
          onExpand();
          if (waiting > 0) requestAnimationFrame(() => void focusWaitingCard());
        }}
        aria-label={`${waiting} waiting on you`}
        title="Waiting on you"
      >
        <CategoryTile cat="human" size="sm" active={waiting > 0} />
        {waiting > 0 && <span className={styles.dockBadge}>{waiting}</span>}
      </button>
      <button
        type="button"
        className={styles.dockItem}
        onClick={onExpand}
        aria-label={cost === null ? "Cost today: connecting" : `Cost today $${cost.toFixed(4)}`}
        title="Cost today"
      >
        <CategoryTile cat="money" size="sm" />
        <span className={styles.dockValue} data-live={live || undefined}>
          {cost === null ? "—" : <CountUp value={cost} format={(n) => `$${n < 1 ? n.toFixed(2) : n.toFixed(1)}`} />}
        </span>
      </button>
      <button
        type="button"
        className={styles.dockItem}
        onClick={onExpand}
        aria-label={`Agent ${state}`}
        title={`Agent: ${state}`}
      >
        <CategoryTile cat="screen" size="sm" />
        <Dot status={dot} size="sm" pulse={state === "working"} className={styles.dockDot} />
      </button>
    </div>
  );
}
