import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import styles from './panel.module.css';

export type PanelTone = 'default' | 'live' | 'attention' | 'critical';

// `title` is widened to ReactNode (badges, counts), so the DOM attribute of the
// same name is excluded rather than shadowed.
export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  /** Rendered at the right of the header — icon buttons, counts, status dots. */
  actions?: ReactNode;
  /** Leading element in the header, e.g. a Dot or LiveGlyph. */
  badge?: ReactNode;
  tone?: PanelTone;
  /** Transparent background, no elevation — for grouping without a surface. */
  quiet?: boolean;
  /** Square the corners and drop side borders (full-bleed sidebar sections). */
  flush?: boolean;
  /** Remove body padding — tables and scroll lists manage their own. */
  bodyFlush?: boolean;
  as?: 'section' | 'div' | 'aside' | 'article';
}

export function Panel({
  title,
  actions,
  badge,
  tone = 'default',
  quiet = false,
  flush = false,
  bodyFlush = false,
  as: Tag = 'section',
  className,
  children,
  ...rest
}: PanelProps) {
  const hasHeader = Boolean(title || actions || badge);

  return (
    <Tag
      className={cn(
        styles.panel,
        tone !== 'default' && styles[tone],
        quiet && styles.quiet,
        flush && styles.flush,
        className,
      )}
      {...rest}
    >
      {hasHeader && (
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            {badge}
            {title && <h2 className={styles.title}>{title}</h2>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div className={cn(styles.body, bodyFlush && styles.bodyFlush)}>{children}</div>
    </Tag>
  );
}
