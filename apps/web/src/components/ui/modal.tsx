"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { IconButton } from "./icon-button";
import styles from "./modal.module.css";

/**
 * Built on the native `<dialog>` element, which gives us focus trapping, Esc
 * handling and an inert background for free — all things a hand-rolled portal
 * gets subtly wrong.
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Wide + full-height layout for the Settings modal. */
  wide?: boolean;
  /** Remove body padding when the content manages its own (tab rails, tables). */
  bodyFlush?: boolean;
  /** Hide the × — use for flows that must be resolved by an explicit choice. */
  hideClose?: boolean;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
  bodyFlush = false,
  hideClose = false,
  className,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cn(styles.dialog, wide && styles.wide, className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      // Esc fires `cancel`; clicking the backdrop fires `click` on the dialog.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header className={styles.header}>
        <div>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {description && (
            <p id={descId} className={styles.description}>
              {description}
            </p>
          )}
        </div>
        {!hideClose && (
          <IconButton
            label="Close"
            icon={<X size={16} weight="bold" />}
            onClick={onClose}
          />
        )}
      </header>

      <div className={cn(styles.body, bodyFlush && styles.bodyFlush)}>{children}</div>

      {footer && <footer className={styles.footer}>{footer}</footer>}
    </dialog>
  );
}
