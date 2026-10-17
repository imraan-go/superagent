'use client';

import type { ReactNode } from 'react';
import { Button, Dot, Skeleton } from '@/components/ui';
import { ManageApiError } from './api';
import styles from './shared.module.css';

export function SectionHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className={styles.heading}>
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}

/** Clear, specific failure state. */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const err = error instanceof ManageApiError ? error : null;
  const headline = err?.code === 'network' ? 'Server unreachable' : 'Something went wrong.';
  const detail = err?.message ?? (error instanceof Error ? error.message : '');
  return (
    <div className={styles.errorNote} role="alert">
      <Dot status="error" size="sm" />
      <div>
        <strong>{headline}</strong>
        {detail && <span>{detail}</span>}
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function SkeletonRows({ rows = 4, height = 36 }: { rows?: number; height?: number }) {
  return (
    <div className={styles.skeletonRows} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </div>
  );
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
