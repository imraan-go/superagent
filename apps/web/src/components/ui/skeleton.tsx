import { cn } from '@/lib/cn';
import styles from './skeleton.module.css';

export interface SkeletonProps {
  /** `text` sizes itself from the font; the rest take explicit dimensions. */
  shape?: 'text' | 'rect' | 'circle' | 'panel';
  width?: number | string;
  height?: number | string;
  className?: string;
}

export function Skeleton({ shape = 'rect', width, height, className }: SkeletonProps) {
  return (
    <span
      className={cn(
        styles.skeleton,
        shape === 'text' && styles.text,
        shape === 'circle' && styles.circle,
        shape === 'panel' && styles.panel,
        className,
      )}
      style={{ width, height }}
      aria-hidden
    />
  );
}

/** A paragraph-shaped placeholder; the final line is intentionally short. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cn(styles.group, className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className={cn(styles.skeleton, styles.text)} />
      ))}
    </span>
  );
}
