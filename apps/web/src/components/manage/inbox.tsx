"use client";

import { WaitingPanel } from "@/components/hitl/waiting-panel";
import { SectionHeader } from "./shared";
import styles from "./shared.module.css";

/** Workspaces → Inbox: every question and approval waiting on you, across chats. */
export function Inbox() {
  return (
    <div className={styles.stack}>
      <SectionHeader title="Inbox">
        Runs wait here durably (no compute while waiting) until you answer, or until the request expires.
      </SectionHeader>
      <WaitingPanel />
    </div>
  );
}
