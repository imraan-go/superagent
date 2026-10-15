"use client";

import { useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { ClockCounterClockwise, Gear, List, Plus } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Drawer, IconButton, LiveGlyph } from "@/components/ui";
import { ConnectionDot } from "@/components/status/connection-dot";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { SettingsModal } from "@/components/settings/settings-modal";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { HitlWatcher, PendingBadge } from "@/components/hitl/hitl-watcher";
import { ModeSwitch } from "./mode-switch";
import { SignOutButton } from "./sign-out-button";
import { cn } from "@/lib/cn";
import styles from "./shell.module.css";

/**
 * The persistent frame: topbar and chat-history rail. Only the centre column
 * and the Mission rail change per route, so switching chats never re-renders
 * the history list.
 */
export function AppShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const params = useParams<{ id?: string }>();
  const pathname = usePathname();
  const manage = pathname.startsWith("/manage");
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Picking a chat (or changing mode) dismisses the history drawer.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setHistoryOpen(false);
  }

  const openSettings = () => {
    setHistoryOpen(false);
    setSettingsOpen(true);
  };

  return (
    <div className={styles.app}>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          {!manage && (
            <IconButton
              label="Chat history"
              icon={<List size={18} />}
              className={styles.menuBtn}
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen(true)}
            />
          )}
          <Link href="/" className={styles.brand} aria-label="Flight Deck home">
            <LiveGlyph state="idle" size={20} label="" />
            Flight Deck
          </Link>
        </div>

        <ModeSwitch />

        <div className={styles.topbarRight}>
          <PendingBadge />
          <span className={styles.hideNarrow}>
            <ConnectionDot />
          </span>
          <ThemeToggle />
          <SignOutButton email={email} />
        </div>
      </header>

      <div className={cn(styles.body, manage && styles.bodyManage)}>
        {!manage && (
          <aside className={styles.sidebarLeft} aria-label="Chats">
            <div className={styles.sidebarFull}>
              <ChatSidebar activeId={params?.id} onOpenSettings={openSettings} />
            </div>
            {/* 820-1100px: the history collapses to an icon rail. */}
            <div className={styles.sidebarIcons}>
              <IconButton
                label="Chat history"
                icon={<ClockCounterClockwise size={18} />}
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen(true)}
              />
              <IconButton label="New chat" icon={<Plus size={18} weight="bold" />} onClick={() => router.push("/")} />
              <IconButton label="Settings" icon={<Gear size={18} />} onClick={openSettings} className={styles.iconsEnd} />
            </div>
          </aside>
        )}
        {children}
      </div>

      {!manage && (
        <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title="Chat history">
          <ChatSidebar activeId={params?.id} onOpenSettings={openSettings} />
        </Drawer>
      )}

      <HitlWatcher />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
