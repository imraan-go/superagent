import type { Metadata } from "next";
import { getOwner } from "@/server/auth/session";
import { Dot, LiveGlyph, Panel, Readout, SkeletonText } from "@/components/ui";
import { ConnectionDot } from "@/components/status/connection-dot";
import { ModeSwitch } from "./mode-switch";
import { SignOutButton } from "./sign-out-button";
import styles from "./shell.module.css";

export const metadata: Metadata = { title: "Flight Deck" };
export const dynamic = "force-dynamic";

/**
 * Phase 0 end state: the real app grid with its regions in place but empty.
 * Phase 1 fills the sidebars, the chat column and the Mission panel.
 */
export default async function AppHome() {
  const owner = await getOwner();

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <LiveGlyph state="idle" size={20} label="" />
          Flight Deck
        </div>

        <ModeSwitch />

        <div className={styles.topbarRight}>
          <ConnectionDot />
          <SignOutButton email={owner?.email ?? ""} />
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.sidebarLeft} aria-label="Chat history">
          <div className={styles.sectionLabel}>History</div>
          <SkeletonText lines={5} />
        </aside>

        <main className={styles.center}>
          <div className={styles.placeholder}>
            <LiveGlyph state="idle" size={64} label="" />
            <h1 className={styles.placeholderTitle}>Shell is up</h1>
            <p>
              Phase 0 is complete: tokens, primitives, database and owner auth.
              The chat column, Mission panel and LHOS link arrive in Phase 1.
            </p>
          </div>
        </main>

        <aside className={styles.sidebarRight} aria-label="Mission panel">
          <Panel title="Usage" badge={<Dot status="idle" />}>
            <div style={{ display: "flex", gap: "var(--sp-5)" }}>
              <Readout label="tokens" value={0} size="sm" />
              <Readout label="cost today" value={0} prefix="$" precision={4} size="sm" />
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
