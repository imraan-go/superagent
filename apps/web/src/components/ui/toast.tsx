'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle, Info, Warning, WarningOctagon, X } from '@phosphor-icons/react/dist/ssr';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { IconButton } from './icon-button';
import styles from './toast.module.css';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastInput {
  title: string;
  message?: string;
  tone?: ToastTone;
  /** 0 keeps it until dismissed — used for errors that need a decision. */
  durationMs?: number;
  action?: { label: string; onClick: () => void };
}

interface Toast extends ToastInput {
  id: number;
}

interface ToastApi {
  push: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Max simultaneously visible; extras wait their turn (DESIGN_SYSTEM §Notifications). */
const MAX_VISIBLE = 3;

const ICONS: Record<ToastTone, ReactNode> = {
  info: <Info size={18} weight="duotone" />,
  success: <CheckCircle size={18} weight="duotone" />,
  warning: <Warning size={18} weight="duotone" />,
  error: <WarningOctagon size={18} weight="duotone" />,
};

const DEFAULT_MS: Record<ToastTone, number> = {
  info: 4000,
  success: 3500,
  warning: 6000,
  error: 0,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setQueue((q) => q.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = Date.now() + Math.random();
      const tone = input.tone ?? 'info';
      const duration = input.durationMs ?? DEFAULT_MS[tone];

      setQueue((q) => [...q, { ...input, tone, id }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({ push, dismiss }), [push, dismiss]);
  const visible = queue.slice(0, MAX_VISIBLE);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.viewport} role="region" aria-label="Notifications">
        {visible.map((toast) => (
          <div
            key={toast.id}
            className={cn(styles.toast, styles[toast.tone ?? 'info'])}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
          >
            <span className={styles.icon} aria-hidden>
              {ICONS[toast.tone ?? 'info']}
            </span>
            <div className={styles.content}>
              <div className={styles.title}>{toast.title}</div>
              {toast.message && <div className={styles.message}>{toast.message}</div>}
              {toast.action && (
                <Button
                  size="sm"
                  variant="outline"
                  className={styles.action}
                  onClick={() => {
                    toast.action?.onClick();
                    dismiss(toast.id);
                  }}
                >
                  {toast.action.label}
                </Button>
              )}
            </div>
            <IconButton
              label="Dismiss"
              size="sm"
              icon={<X size={14} weight="bold" />}
              onClick={() => dismiss(toast.id)}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
