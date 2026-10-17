'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import styles from './segmented-switch.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedSwitchProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** `pill`: sliding filled thumb (mode switch). `underline`: sliding bar (tab strips). */
  variant?: 'pill' | 'underline';
  /** Accessible name for the group, e.g. "Workspace mode". */
  label: string;
  className?: string;
}

/**
 * Tabs-pattern segmented control. The thumb is measured from the live DOM
 * rather than assuming equal widths, so options can carry labels of any length.
 */
export function SegmentedSwitch<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  variant = 'pill',
  label,
  className,
}: SegmentedSwitchProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const measure = () => {
      const el = root.querySelectorAll<HTMLButtonElement>("[role='tab']")[selectedIndex];
      if (!el) return;
      setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [selectedIndex, options.length]);

  const move = (delta: number) => {
    const next = (selectedIndex + delta + options.length) % options.length;
    const option = options[next];
    if (option && !option.disabled) onChange(option.value);
  };

  return (
    <div
      ref={rootRef}
      role="tablist"
      aria-label={label}
      className={cn(styles.root, size === 'sm' && styles.sm, variant === 'underline' && styles.underline, className)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      <span
        className={styles.thumb}
        style={thumb ? { transform: `translateX(${thumb.left}px)`, width: thumb.width } : { opacity: 0 }}
        aria-hidden
      />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            className={styles.option}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
