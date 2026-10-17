'use client';

import { useState } from 'react';
import { logoSrc } from '@/lib/apps';
import { cn } from '@/lib/cn';
import styles from './apps.module.css';

/**
 * App logo through the same-origin proxy (CSP `img-src 'self'`). Falls back to a
 * letter tile when the toolkit has no logo or the image fails to load.
 */
export function AppLogo({
  slug,
  name,
  size = 40,
  className,
}: {
  slug: string;
  name?: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const letter = (name ?? slug).trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className={cn(styles.logo, className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      data-size={size}
    >
      {failed ? (
        <span className={styles.logoLetter} aria-hidden>
          {letter}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoSrc(slug)}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

/** Overlapping logos with a "+N" tail. Decorative; the neighbouring text carries the count. */
export function LogoStack({ slugs, max = 4, size = 20 }: { slugs: string[]; max?: number; size?: number }) {
  const shown = slugs.slice(0, max);
  const extra = slugs.length - shown.length;
  return (
    <span className={styles.stack} aria-hidden>
      {shown.map((s) => (
        <AppLogo key={s} slug={s} size={size} className={styles.stackLogo} />
      ))}
      {extra > 0 && (
        <span className={styles.stackMore} style={{ height: size, minWidth: size }}>
          +{extra}
        </span>
      )}
    </span>
  );
}
