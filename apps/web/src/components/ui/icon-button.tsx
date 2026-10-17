import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import styles from './icon-button.module.css';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required — icon-only controls carry no visible text. */
  label: string;
  icon: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  pill?: boolean;
  active?: boolean;
  tone?: 'default' | 'danger';
}

export function IconButton({
  label,
  icon,
  size = 'md',
  pill = false,
  active = false,
  tone = 'default',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={cn(
        styles.base,
        styles[size],
        pill && styles.pill,
        active && styles.active,
        tone === 'danger' && styles.danger,
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
