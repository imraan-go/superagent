'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import styles from './settings-tabs.module.css';

/**
 * Small form controls shared by the Settings tabs. They live here rather than
 * in `components/ui` because only Settings needs them today.
 */

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name — the SettingRow label is visual only. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cn(styles.toggle, checked && styles.toggleOn)}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.toggleThumb} aria-hidden />
    </button>
  );
}

/**
 * Number input that commits on blur or Enter, not on every keystroke, so a
 * half-typed value never round-trips to the server.
 */
export function NumberField({
  value,
  onCommit,
  label,
  min,
  max,
  step = 1,
  prefix,
  suffix,
  width = 96,
}: {
  value: number;
  onCommit: (next: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  width?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  // Re-sync when the saved value changes underneath (render-phase adjust).
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(String(value));
  }

  const commit = () => {
    const next = Number(draft);
    if (!Number.isFinite(next) || draft.trim() === '') return setDraft(String(value));
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <span className={styles.numberField}>
      {prefix && <span className={styles.affix}>{prefix}</span>}
      <input
        type="number"
        inputMode="decimal"
        aria-label={label}
        className={styles.input}
        style={{ width }}
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      {suffix && <span className={styles.affix}>{suffix}</span>}
    </span>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
  label: string;
}) {
  return (
    <select aria-label={label} className={styles.select} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <p role="alert" className={styles.error}>
      {message}
    </p>
  );
}
