"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
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

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
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
