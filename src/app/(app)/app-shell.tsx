"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { Command, List } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Drawer, IconButton, LiveGlyph } from "@/components/ui";
import { ConnectionDot } from "@/components/status/connection-dot";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { SettingsModal } from "@/components/settings/settings-modal";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { HitlWatcher, PendingBadge } from "@/components/hitl/hitl-watcher";
import { CommandPalette } from "@/components/command/command-palette";
import { ShortcutSheet } from "@/components/command/shortcut-sheet";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { WIDE_QUERY, useMedia } from "@/hooks/use-media";
import { PREF_LEFT_COLLAPSED, usePref } from "@/lib/ui-prefs";
import { useNewChat } from "@/hooks/use-new-chat";
import { OPEN_SETTINGS_EVENT, focusPrompt, focusWaitingCard } from "@/lib/app-events";
import type { OpenSettingsDetail } from "@/lib/app-events";
import { ModeSwitch } from "./mode-switch";
import { SignOutButton } from "./sign-out-button";
import { cn } from "@/lib/cn";
import styles from "./shell.module.css";

/**
 * The persistent frame (DESIGN_SYSTEM §Layout): a full-height left rail, a
 * glass topbar over the centre column only, and — owned by the route — a
 * full-height right rail. `.body` is `display: contents`, so the route's
 * <main> and <aside> land directly in the app grid. Only the centre column
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [leftPref, setLeftCollapsed] = usePref(PREF_LEFT_COLLAPSED);
  const wide = useMedia(WIDE_QUERY);
  // 820–1100px always shows the icon rail; above that the owner chooses.
  const leftCollapsed = leftPref || !wide;

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
    { keys: "mod+b", allowInInput: true, handler: () => setLeftCollapsed((v) => !v) },
    { keys: "?", handler: free(() => setShortcutsOpen(true)) },
    { keys: "g m", handler: free(() => router.push("/manage")) },
    { keys: "g a", handler: free(() => router.push("/")) },
    { keys: "g w", handler: free(() => void focusWaitingCard()) },
  ]);

  // Picking a chat (or changing mode) dismisses the history drawer.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setHistoryOpen(false);
  }

  const openSettings = () => {
    setHistoryOpen(false);
    setSettingsTab(undefined);
    setSettingsOpen(true);
  };

  return (
    <div
      className={cn(styles.app, manage && styles.appManage)}
      data-left={manage ? undefined : leftCollapsed ? "rail" : "full"}
    >
      <span className={styles.aurora} aria-hidden />
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      {!manage && (
        <aside className={styles.sidebarLeft} aria-label="Chats">
          <ChatSidebar
            activeId={params?.id}
            onOpenSettings={openSettings}
            email={email}
            collapsed={leftCollapsed}
            onToggleCollapsed={wide ? () => setLeftCollapsed((v) => !v) : undefined}
          />
        </aside>
      )}

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
          <Link href="/" className={styles.brand} aria-label="LHOS home">
            <LiveGlyph state="idle" size={20} label="" className={styles.brandGlyph} />
            <span className={styles.wordmark}>LHOS</span>
          </Link>
          <button
            type="button"
            className={styles.paletteBtn}
            onClick={() => setPaletteOpen(true)}
            aria-label="Command palette"
            aria-keyshortcuts="Control+K Meta+K"
          >
            <Command size={14} weight="bold" aria-hidden />
            <span className={styles.paletteText}>Ask, jump or run…</span>
            <kbd className={styles.kbd}>⌘K</kbd>
          </button>
        </div>

        <ModeSwitch />

        <div className={styles.topbarRight}>
          <PendingBadge />
          <span className={styles.hideNarrow}>
            <ConnectionDot />
          </span>
          <ThemeToggle />
          <span className={styles.topSignOut}>
            <SignOutButton email={email} />
          </span>
        </div>
      </header>

      <div className={styles.body}>{children}</div>

      {!manage && (
        <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title="Chat history">
          <ChatSidebar activeId={params?.id} onOpenSettings={openSettings} email={email} />
        </Drawer>
      )}

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
