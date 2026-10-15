"use client";

import { useState } from "react";
import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import { LiveGlyph } from "@/components/ui";
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
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          <LiveGlyph state="idle" size={20} label="" />
          Flight Deck
        </Link>

        <ModeSwitch />

        <div className={styles.topbarRight}>
          <PendingBadge />
          <ConnectionDot />
          <ThemeToggle />
          <SignOutButton email={email} />
        </div>
      </header>

      <div className={cn(styles.body, manage && styles.bodyManage)}>
        {!manage && (
          <aside className={styles.sidebarLeft}>
            <ChatSidebar
              activeId={params?.id}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </aside>
        )}
        {children}
      </div>

      <HitlWatcher />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
