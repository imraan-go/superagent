'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import styles from './apps.module.css';

export const ROW_H = 72;
const OVERSCAN = 4;
const TWO_COL_MIN = 640;

/** Move focus through the grid with the arrow keys (Up/Down jump a whole row of columns). */
export function gridKeyNav(e: React.KeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const target = e.target as HTMLElement;
  if (!target.matches('[data-app-main]')) return;
  const root = e.currentTarget;
  const items = [...root.querySelectorAll<HTMLElement>('[data-app-main]')];
  const i = items.indexOf(target);
  if (i < 0) return;
  // Columns = how many items share the first row's top edge.
  const top = items[0]!.getBoundingClientRect().top;
  const cols = Math.max(1, items.filter((el) => Math.abs(el.getBoundingClientRect().top - top) < 4).length);
  const next =
    e.key === 'ArrowRight'
      ? i + 1
      : e.key === 'ArrowLeft'
        ? i - 1
        : e.key === 'ArrowDown'
          ? i + cols
          : e.key === 'ArrowUp'
            ? i - cols
            : e.key === 'Home'
              ? 0
              : items.length - 1;
  const el = items[Math.max(0, Math.min(items.length - 1, next))];
  if (el && el !== target) {
    e.preventDefault();
    el.focus();
  }
}

/**
 * Windowed 1-2 column list for the whole catalog (1600+ rows). Only rows near
 * the viewport are in the DOM; unloaded rows render skeletons. `scrollEl` is
 * the scrolling ancestor, `total` the full count, `getItem` returns a rendered
 * row or undefined while its page is still loading, `onRange` reports the last
 * visible index so the parent can fetch ahead.
 */
export function VirtualGrid({
  scrollEl,
  total,
  getItem,
  skeleton,
  onRange,
}: {
  scrollEl: HTMLElement | null;
  total: number;
  getItem: (index: number) => ReactNode | undefined;
  skeleton: (index: number) => ReactNode;
  onRange: (lastIndex: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600, cols: 2 });

  useEffect(() => {
    if (!scrollEl) return;
    const measure = () => {
      const host = hostRef.current;
      const offset = host
        ? host.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop
        : 0;
      setView({
        top: Math.max(0, scrollEl.scrollTop - offset),
        height: scrollEl.clientHeight,
        cols: (host?.clientWidth ?? scrollEl.clientWidth) >= TWO_COL_MIN ? 2 : 1,
      });
    };
    measure();
    scrollEl.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
    return () => {
      scrollEl.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [scrollEl]);

  const { cols } = view;
  const rows = Math.ceil(total / cols);
  const first = Math.max(0, Math.floor(view.top / ROW_H) - OVERSCAN);
  const last = Math.min(rows - 1, Math.ceil((view.top + view.height) / ROW_H) + OVERSCAN);
  const lastIndex = Math.min(total - 1, (last + 1) * cols - 1);

  useEffect(() => {
    if (total > 0) onRange(lastIndex);
  }, [lastIndex, total, onRange]);

  const out: ReactNode[] = [];
  for (let r = first; r <= last; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const idx = r * cols + c;
      if (idx >= total) break;
      const style = {
        position: 'absolute',
        top: r * ROW_H,
        left: `${(c * 100) / cols}%`,
        width: `${100 / cols}%`,
        height: ROW_H,
      } as const;
      out.push(
        <div key={idx} role="listitem" className={styles.vcell} style={style} data-index={idx}>
          {getItem(idx) ?? skeleton(idx)}
        </div>,
      );
    }
  }
  return (
    <div
      ref={hostRef}
      className={styles.vgrid}
      style={{ height: rows * ROW_H }}
      role="list"
      aria-label={`${total} apps`}
    >
      {out}
    </div>
  );
}
