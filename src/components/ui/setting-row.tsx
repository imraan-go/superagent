import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import styles from "./setting-row.module.css";

/**
 * One settings line: label + muted description on the left, control on the
 * right (DESIGN_SYSTEM §Reference reading). Every Settings tab is then just
 * rows inside section cards — no bespoke layout per tab.
 */
export interface SettingRowProps {
  label: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingRow({ label, description, children, className }: SettingRowProps) {
  return (
    <div className={cn(styles.row, className)}>
      <div className={styles.copy}>
        <div className={styles.label}>{label}</div>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      <div className={styles.control}>{children}</div>
    </div>
  );
}

export function SettingSection({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      {title && <h3 className={styles.sectionTitle}>{title}</h3>}
      <div className={styles.card}>{children}</div>
    </section>
  );
}
