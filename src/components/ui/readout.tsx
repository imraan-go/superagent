"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import styles from "./readout.module.css";

export type ReadoutTone = "default" | "signal" | "amber" | "danger" | "ok";

export interface ReadoutProps {
  label: string;
  /** Numbers animate from the previous value; strings swap immediately. */
  value: number | string;
  unit?: string;
  /** Pre-value symbol, e.g. "$" for cost. */
  prefix?: string;
  size?: "sm" | "md" | "lg";
  tone?: ReadoutTone;
  /** Label and value on one baseline instead of stacked. */
  inline?: boolean;
  /** Decimal places for numeric values. */
  precision?: number;
  /** Renders a `~` marker — streamed usage before exact totals arrive. */
  estimate?: boolean;
  className?: string;
}

const COUNT_UP_MS = 280;

/**
 * Linear count-up — no easing bounce (docs/DESIGN_SYSTEM.md §Signature).
 * State is only written from inside the animation frame, never synchronously
 * in the effect body, so a value change cannot cascade a render.
 */
function useCountUp(target: number, enabled: boolean): number {
  const [display, setDisplay] = useState(target);
  // Last value actually painted — animating from here keeps rapid updates
  // (a streaming token ticker) continuous instead of jumping.
  const shownRef = useRef(target);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      // Keep the baseline current so re-enabling animates from what is on screen.
      shownRef.current = target;
      return;
    }

    const from = shownRef.current;
    if (from === target) return;

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      const next = from + (target - from) * t;
      shownRef.current = next;
      setDisplay(next);
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, [target, enabled]);

  return enabled ? display : target;
}

export function Readout({
  label,
  value,
  unit,
  prefix,
  size = "md",
  tone = "default",
  inline = false,
  precision,
  estimate = false,
  className,
}: ReadoutProps) {
  const isNumeric = typeof value === "number";
  const reduced = useReducedMotion();
  const animated = useCountUp(isNumeric ? value : 0, isNumeric && !reduced);

  const decimals = precision ?? (isNumeric && !Number.isInteger(value) ? 2 : 0);
  const text = isNumeric
    ? animated.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    : value;

  return (
    <div
      className={cn(
        styles.readout,
        styles[size],
        tone !== "default" && styles[tone],
        inline && styles.inline,
        estimate && styles.estimate,
        className,
      )}
    >
      <span className={styles.label}>{label}</span>
      <span className={styles.valueRow}>
        {estimate && (
          <span className={styles.estimateMark} title="Estimated until the stream closes">
            ~
          </span>
        )}
        {prefix && <span className={styles.value}>{prefix}</span>}
        {/* Keying on the settled value remounts the span, which restarts the
            flash animation — no state, no effect. */}
        <span key={String(value)} className={cn(styles.value, styles.flash)}>
          {text}
        </span>
        {unit && <span className={styles.unit}>{unit}</span>}
      </span>
    </div>
  );
}
