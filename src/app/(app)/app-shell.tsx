"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { LiveGlyph } from "@/components/ui";
import { ConnectionDot } from "@/components/status/connection-dot";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { SettingsModal } from "@/components/settings/settings-modal";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { HitlWatcher, PendingBadge } from "@/components/hitl/hitl-watcher";
import { CommandPalette } from "@/components/command/command-palette";
import { ShortcutSheet } from "@/components/command/shortcut-sheet";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useNewChat } from "@/hooks/use-new-chat";
import { OPEN_SETTINGS_EVENT, focusPrompt, focusWaitingCard } from "@/lib/app-events";
import type { OpenSettingsDetail } from "@/lib/app-events";
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
  const newChat = useNewChat();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Palette (or anything else) can open Settings at a specific tab.
  useEffect(() => {
    const onOpen = (e: Event) => {
      setSettingsTab((e as CustomEvent<OpenSettingsDetail>).detail?.tab);
      setSettingsOpen(true);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
  }, []);

  // Bare-key shortcuts stand down while any dialog owns the screen. Esc is
  // handled by the native <dialog>, which always closes the topmost one.
  const free = (fn: () => void) => () => {
    if (!document.querySelector("dialog[open]")) fn();
  };
  useHotkeys([
    { keys: "mod+k", allowInInput: true, handler: () => setPaletteOpen((o) => !o) },
    { keys: "mod+j", allowInInput: true, handler: free(() => newChat.mutate()) },
    { keys: "mod+/", allowInInput: true, handler: free(() => void focusPrompt()) },
    { keys: "?", handler: free(() => setShortcutsOpen(true)) },
    { keys: "g m", handler: free(() => router.push("/manage")) },
    { keys: "g a", handler: free(() => router.push("/")) },
    { keys: "g w", handler: free(() => void focusWaitingCard()) },
  ]);

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
              onOpenSettings={() => {
                setSettingsTab(undefined);
                setSettingsOpen(true);
              }}
            />
          </aside>
        )}
        {children}
      </div>

      <HitlWatcher />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        requestedTab={settingsTab}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
