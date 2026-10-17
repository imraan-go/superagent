import { cn } from '@/lib/cn';
import styles from './dot.module.css';

export type DotStatus = 'ok' | 'live' | 'warn' | 'error' | 'idle' | 'pending';

export interface DotProps {
  status: DotStatus;
  size?: 'sm' | 'md' | 'lg';
  /** Expanding ring — use for genuinely live state, not decoration. */
  pulse?: boolean;
  /** Accessible description; omit only when an adjacent label already says it. */
  label?: string;
  className?: string;
}

export function Dot({ status, size = 'md', pulse = false, label, className }: DotProps) {
  return (
    <span
      className={cn(styles.dot, styles[size], styles[status], pulse && styles.pulse, className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
