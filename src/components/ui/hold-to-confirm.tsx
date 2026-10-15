"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { isTypingTarget } from "@/lib/hotkeys";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import styles from "./hold-to-confirm.module.css";

/**
 * Press-and-hold gate for irreversible actions: service restarts, taking
 * control of the desktop, destructive settings. Firing requires a sustained
 * hold, so a stray click can never trigger it.
 *
 * Keyboard: Space or Enter held down works identically, and releasing early
 * cancels — the control is operable without a pointer.
 */
export interface HoldToConfirmProps {
  onConfirm: () => void;
  children: ReactNode;
  /** Default 600 ms, matching `manage.confirmHoldMs` in settings. */
  holdMs?: number;
  tone?: "attention" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  icon?: ReactNode;
  /** Shown beside the label, e.g. "hold". */
  hint?: string;
  className?: string;
  /** Accessible name when `children` is not descriptive on its own. */
  label?: string;
  /**
   * Extra key that holds the control from elsewhere in `keyScope` (e.g. `a` on
   * a focused approval card). It is a *hold*, never a tap: releasing early
   * cancels, auto-repeat is ignored, and typing in a field never triggers it.
   */
  holdKey?: string;
  keyScope?: RefObject<HTMLElement | null>;
}

export function HoldToConfirm({
  onConfirm,
  children,
  holdMs = 600,
  tone = "attention",
  size = "md",
  disabled = false,
  icon,
  hint = "hold",
  className,
  label,
  holdKey,
  keyScope,
}: HoldToConfirmProps) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const rafRef = useRef<number | undefined>(undefined);
  const startRef = useRef(0);
  const firedRef = useRef(false);
  const reduced = useReducedMotion();

  const stop = useCallback(() => {
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    rafRef.current = undefined;
    setHolding(false);
    setProgress(0);
  }, []);

  const start = useCallback(() => {
    if (disabled || holding) return;
    firedRef.current = false;
    startRef.current = performance.now();
    setHolding(true);

    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / holdMs);
      setProgress(t);
      if (t >= 1) {
        if (!firedRef.current) {
          firedRef.current = true;
          onConfirm();
        }
        stop();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [disabled, holding, holdMs, onConfirm, stop]);

  useEffect(() => stop, [stop]);

  // Latest start/stop for the scoped key listeners without re-subscribing.
  const controlsRef = useRef({ start, stop });
  useEffect(() => {
    controlsRef.current = { start, stop };
  });

  useEffect(() => {
    const scope = keyScope?.current;
    if (!holdKey || !scope) return;
    const want = holdKey.toLowerCase();
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== want || e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target as Element)) return;
      e.preventDefault();
      controlsRef.current.start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === want) controlsRef.current.stop();
    };
    scope.addEventListener("keydown", down);
    scope.addEventListener("keyup", up);
    const cancel = () => controlsRef.current.stop();
    scope.addEventListener("focusout", cancel);
    return () => {
      scope.removeEventListener("keydown", down);
      scope.removeEventListener("keyup", up);
      scope.removeEventListener("focusout", cancel);
    };
  }, [holdKey, keyScope]);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      aria-keyshortcuts={holdKey ? holdKey.toUpperCase() : undefined}
      aria-describedby={undefined}
      className={cn(
        styles.base,
        styles[tone],
        size === "sm" && styles.sm,
        holding && styles.holding,
        className,
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (!e.repeat) start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") stop();
      }}
      onBlur={stop}
    >
      <span
        className={styles.fill}
        style={{ width: `${(reduced ? (holding ? 100 : 0) : progress * 100).toFixed(1)}%` }}
        aria-hidden
      />
      <span className={styles.label}>
        {icon}
        {children}
        {hint && !holding && <span className={styles.hint}>{hint}</span>}
      </span>
    </button>
  );
}
