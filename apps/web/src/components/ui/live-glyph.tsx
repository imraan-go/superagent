import { cn } from '@/lib/cn';
import styles from './live-glyph.module.css';

/**
 * The reactive loader that gives the app its pulse. One component, driven
 * entirely by `state`; rendered at 20px in the prompt bar, 28px in the right
 * panel and 96px on the splash (docs/DESIGN_SYSTEM.md §Signature elements).
 */
export type LiveGlyphState = 'idle' | 'thinking' | 'tool' | 'approval' | 'done' | 'error';

export interface LiveGlyphProps {
  state?: LiveGlyphState;
  /** Rendered pixel size; stroke weight scales with it. */
  size?: number;
  className?: string;
  /** Screen-reader text. Pass "" when a sibling already announces run state. */
  label?: string;
}

const STATE_LABEL: Record<LiveGlyphState, string> = {
  idle: 'Agent idle',
  thinking: 'Agent thinking',
  tool: 'Running a tool',
  approval: 'Waiting for your approval',
  done: 'Finished',
  error: 'Failed',
};

export function LiveGlyph({ state = 'idle', size = 20, className, label }: LiveGlyphProps) {
  // Keep the stroke optically consistent across the 20 → 96 px range.
  const stroke = Math.max(1.25, size * 0.07);
  const text = label ?? STATE_LABEL[state];

  return (
    <span
      className={cn(styles.root, styles[state], className)}
      style={{ width: size, height: size }}
      role={text ? 'status' : undefined}
      aria-label={text || undefined}
      aria-live={text ? 'polite' : undefined}
    >
      <svg className={styles.svg} width={size} height={size} viewBox="0 0 40 40" aria-hidden>
        {/* Three arcs at different radii and phases — the orbital signature. */}
        <circle
          className={cn(styles.arc, styles.a1)}
          cx="20"
          cy="20"
          r="17"
          strokeWidth={stroke}
          strokeDasharray="30 77"
        />
        <circle
          className={cn(styles.arc, styles.a2)}
          cx="20"
          cy="20"
          r="12.5"
          strokeWidth={stroke}
          strokeDasharray="20 59"
          strokeDashoffset="12"
        />
        <circle
          className={cn(styles.arc, styles.a3)}
          cx="20"
          cy="20"
          r="8"
          strokeWidth={stroke}
          strokeDasharray="12 38"
          strokeDashoffset="26"
        />
        <circle className={styles.core} cx="20" cy="20" r={Math.max(1.5, size * 0.055)} />
      </svg>
    </span>
  );
}
