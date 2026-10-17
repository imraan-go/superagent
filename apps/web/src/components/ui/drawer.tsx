'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from '@phosphor-icons/react/dist/ssr';
import { IconButton } from './icon-button';
import styles from './drawer.module.css';

/**
 * A modal side sheet on the native `<dialog>`: focus is trapped, Esc closes it
 * and the browser restores focus to the control that opened it. Content is
 * mounted only while open, so a closed drawer costs nothing.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.drawer}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <IconButton label={`Close ${title.toLowerCase()}`} icon={<X size={16} weight="bold" />} onClick={onClose} />
      </header>
      <div className={styles.body}>{open ? children : null}</div>
    </dialog>
  );
}
