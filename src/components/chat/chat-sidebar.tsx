"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CaretDoubleLeft,
  CaretDoubleRight,
  Gear,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  PushPin,
  SignOut,
  SquaresFour,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { ChatSummary } from "@/lib/api";
import { groupChats } from "@/lib/chat-groups";
import { CategoryTile, Dot, IconButton, LiveGlyph, SkeletonText } from "@/components/ui";
import type { TileCategory } from "@/components/ui";
import { useCapabilities } from "@/hooks/use-capabilities";
import { LogoStack } from "@/components/apps/app-logo";
import { useConnectedApps } from "@/components/apps/use-composio";
import { openApps } from "@/lib/app-events";
import { cn } from "@/lib/cn";
import styles from "./chat-sidebar.module.css";

/**
 * The left rail (DESIGN_SYSTEM §Layout → Left rail). Fixed full height:
 * brand + New chat, search, then the ONLY scrolling region — chat groups with
 * sticky headers — and a fixed dock (computer status, Settings, owner).
 * `collapsed` renders the same rail as a 56px icon strip.
 */
export function ChatSidebar({
  activeId,
  onOpenSettings,
  email,
  collapsed = false,
  onToggleCollapsed,
}: {
  activeId?: string;
  onOpenSettings: () => void;
  email?: string;
  collapsed?: boolean;
  /** Present only on the docked rail (not in the history drawer). */
  onToggleCollapsed?: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");

  const { data, isPending } = useQuery({
    queryKey: ["chats"],
    queryFn: api.listChats,
    // Status lines are only interesting while something is running.
    refetchInterval: (q) =>
      q.state.data?.chats.some((c) => c.status === "running") ? 4_000 : 30_000,
  });

  const createChat = useMutation({
    mutationFn: api.createChat,
    onSuccess: async ({ chat }) => {
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      router.push(`/chat/${chat.id}`);
    },
  });

  const filtered = useMemo(() => {
    const chats = data?.chats ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return chats;
    return chats.filter((c) => c.title.toLowerCase().includes(needle));
  }, [data?.chats, query]);

  const groups = useMemo(() => groupChats(filtered), [filtered]);

  return (
    <div className={styles.root} data-collapsed={collapsed || undefined}>
      <div className={styles.head}>
        <div className={styles.brandRow}>
          <Link href="/" className={styles.brand} aria-label="LHOS home">
            <span className={styles.mark}>
              <LiveGlyph state="idle" size={22} label="" className={styles.markGlyph} />
            </span>
            {!collapsed && (
              <span className={styles.wordmark}>
                LHOS<span className={styles.wordSub}>super-agent OS</span>
              </span>
            )}
          </Link>
          {onToggleCollapsed && (
            <IconButton
              label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              size="sm"
              aria-keyshortcuts="Control+B Meta+B"
              icon={collapsed ? <CaretDoubleRight size={14} /> : <CaretDoubleLeft size={14} />}
              onClick={onToggleCollapsed}
              className={styles.collapseBtn}
            />
          )}
        </div>

        {collapsed ? (
          <IconButton
            label="New chat"
            icon={<Plus size={18} weight="bold" />}
            className={styles.newIcon}
            onClick={() => createChat.mutate()}
            disabled={createChat.isPending}
          />
        ) : (
          <>
            <button
              type="button"
              className={styles.newChat}
              onClick={() => createChat.mutate()}
              disabled={createChat.isPending}
            >
              <Plus size={16} weight="bold" aria-hidden />
              New chat
              <kbd className={styles.kbd} aria-hidden>
                ⌘J
              </kbd>
            </button>
            <div className={styles.search}>
              <MagnifyingGlass size={14} weight="bold" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats"
                aria-label="Search chats"
              />
            </div>
          </>
        )}
      </div>

      <nav className={styles.list} aria-label="Chat history">
        {isPending ? (
          <div className={styles.loading}>
            <SkeletonText lines={collapsed ? 3 : 5} />
          </div>
        ) : filtered.length === 0 ? (
          !collapsed && (
            <p className={styles.empty}>
              {query ? "No chats match that." : "No chats yet. Start one above."}
            </p>
          )
        ) : collapsed ? (
          <ul className={styles.mini}>
            {filtered.slice(0, 14).map((chat, i) => (
              <li key={chat.id} className="rise-in" style={{ "--i": i } as React.CSSProperties}>
                <Link
                  href={`/chat/${chat.id}`}
                  className={cn(styles.miniLink, chat.id === activeId && styles.miniActive)}
                  aria-current={chat.id === activeId ? "page" : undefined}
                  aria-label={chat.title}
                  title={chat.title}
                >
                  <CategoryTile cat={chatCategory(chat)} size="sm" active={chat.status === "running"} />
                  {statusOf(chat) !== "idle" && (
                    <Dot status={statusOf(chat)} size="sm" className={styles.miniDot} />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          groups.map((group, g) => (
            <Section key={group.key} label={group.label} count={group.chats.length}>
              {group.chats.map((chat, i) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  active={chat.id === activeId}
                  index={g * 3 + i}
                />
              ))}
            </Section>
          ))
        )}
      </nav>

      <div className={styles.dock}>
        <ComputerCard collapsed={collapsed} />
        <ConnectAppsButton collapsed={collapsed} />
        {collapsed ? (
          <IconButton label="Settings" icon={<Gear size={18} weight="duotone" />} onClick={onOpenSettings} />
        ) : (
          <button type="button" className={styles.dockBtn} onClick={onOpenSettings}>
            <Gear size={16} weight="duotone" aria-hidden />
            Settings
          </button>
        )}
        {email !== undefined && <Owner email={email} collapsed={collapsed} />}
      </div>
    </div>
  );
}

function Section({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>
        {label}
        <span className={styles.sectionCount}>{count}</span>
      </h2>
      {children}
    </section>
  );
}

/** Agent computer at a glance; the full view lives in the right rail. */
function ComputerCard({ collapsed }: { collapsed: boolean }) {
  const { capabilities, state, dot } = useCapabilities();
  const pulse = state === "awake" || state === "waking";
  if (collapsed) {
    return (
      <span className={styles.computerMini} title={`Agent computer: ${state}`}>
        <CategoryTile cat="screen" size="sm" />
        <Dot status={dot} size="sm" pulse={pulse} className={styles.miniDot} label={`Agent computer ${state}`} />
      </span>
    );
  }
  return (
    <div className={styles.computer} data-state={state}>
      <CategoryTile cat="screen" size="md" active={state === "waking"} />
      <span className={styles.computerText}>
        <span className={styles.computerName}>Agent computer</span>
        <span className={styles.computerSub}>
          {capabilities?.sandboxId ? capabilities.sandboxId.slice(0, 12) : "sandbox"}
          {capabilities?.rdpConnected ? " · RDP linked" : ""}
        </span>
      </span>
      <span className={styles.computerState}>
        <Dot status={dot} size="sm" pulse={pulse} />
        {state}
      </span>
    </div>
  );
}

/** Dock entry for the Connect Apps modal, with a mini stack of connected-app logos. */
function ConnectAppsButton({ collapsed }: { collapsed: boolean }) {
  const { slugs, count } = useConnectedApps();
  if (collapsed) {
    return <IconButton label={count ? `Connect apps (${count} connected)` : "Connect apps"} icon={<SquaresFour size={18} weight="duotone" />} onClick={() => openApps()} />;
  }
  return (
    <button type="button" className={styles.dockBtn} onClick={() => openApps()} data-apps-btn>
      <SquaresFour size={16} weight="duotone" aria-hidden />
      <span className={styles.dockLabel}>Connect apps</span>
      {count > 0 && (
        <span className={styles.appsTail}>
          <LogoStack slugs={slugs} max={3} size={18} />
          <span className={styles.appsCount}>{count}</span>
        </span>
      )}
    </button>
  );
}

function Owner({ email, collapsed }: { email: string; collapsed: boolean }) {
  const router = useRouter();
  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };
  const initial = (email.trim()[0] ?? "O").toUpperCase();
  if (collapsed) {
    return (
      <IconButton label={email ? `Sign out ${email}` : "Sign out"} icon={<SignOut size={16} />} onClick={signOut} />
    );
  }
  return (
    <div className={styles.owner}>
      <span className={styles.avatar} aria-hidden>
        {initial}
      </span>
      <span className={styles.ownerText}>
        <span className={styles.ownerName}>Owner</span>
        <span className={styles.ownerMail} title={email}>
          {email || "signed in"}
        </span>
      </span>
      <IconButton
        label={email ? `Sign out ${email}` : "Sign out"}
        size="sm"
        icon={<SignOut size={14} />}
        onClick={signOut}
      />
    </div>
  );
}

function ChatRow({ chat, active, index }: { chat: ChatSummary; active: boolean; index: number }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["chats"] });
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(chat.title);

  const pin = useMutation({
    mutationFn: () => api.updateChat(chat.id, { pinned: !chat.pinned }),
    onSuccess: invalidate,
  });

  const rename = useMutation({
    mutationFn: (title: string) => api.updateChat(chat.id, { title }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => api.deleteChat(chat.id),
    onSuccess: async () => {
      await invalidate();
      if (active) router.push("/");
    },
  });

  const status = statusOf(chat);
  const commit = () => {
    const title = draft.trim();
    setRenaming(false);
    if (title && title !== chat.title) rename.mutate(title);
  };

  return (
    <div
      className={cn(styles.row, active && styles.rowActive, "rise-in")}
      data-status={status}
      style={{ "--i": index } as React.CSSProperties}
    >
      {renaming ? (
        <div className={styles.renameBox}>
          <CategoryTile cat={chatCategory(chat)} size="sm" />
          <input
            autoFocus
            className={styles.renameInput}
            value={draft}
            aria-label="Chat title"
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                e.stopPropagation();
                setDraft(chat.title);
                setRenaming(false);
              }
            }}
          />
        </div>
      ) : (
        <Link href={`/chat/${chat.id}`} className={styles.rowLink} aria-current={active ? "page" : undefined}>
          <span className={styles.tileWrap}>
            <CategoryTile cat={chatCategory(chat)} size="sm" active={chat.status === "running"} />
            {status !== "idle" && <Dot status={status} size="sm" pulse={status === "live"} className={styles.tileDot} />}
          </span>
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>{chat.title}</span>
            <span className={styles.rowMeta}>
              {chat.statusLine ? (
                <span className={styles.rowStatus}>{chat.statusLine}</span>
              ) : (
                <span className={styles.rowTime}>{relativeTime(chat.updatedAt)}</span>
              )}
            </span>
          </span>
          {chat.pinned && <PushPin size={11} weight="fill" className={styles.pinMark} aria-label="Pinned" />}
        </Link>
      )}

      {!renaming && (
        <span className={styles.rowActions}>
          <IconButton
            label={chat.pinned ? "Unpin chat" : "Pin chat"}
            size="sm"
            icon={<PushPin size={13} weight={chat.pinned ? "fill" : "regular"} />}
            onClick={() => pin.mutate()}
          />
          <IconButton
            label="Rename chat"
            size="sm"
            icon={<PencilSimple size={13} />}
            onClick={() => {
              setDraft(chat.title);
              setRenaming(true);
            }}
          />
          <IconButton
            label="Delete chat"
            size="sm"
            tone="danger"
            icon={<Trash size={13} />}
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          />
        </span>
      )}
    </div>
  );
}

function statusOf(chat: ChatSummary) {
  switch (chat.status) {
    case "running":
      return "live" as const;
    case "paused_approval":
    case "paused_question":
      return "warn" as const;
    case "error":
      return "error" as const;
    default:
      return "idle" as const;
  }
}

/**
 * The chat list carries no per-run tool data, so the tile is inferred from the
 * live status line and the title — what the chat is visibly about.
 */
export function chatCategory(chat: Pick<ChatSummary, "title" | "statusLine" | "status">): TileCategory {
  if (chat.status === "error") return "error";
  if (chat.status === "paused_approval" || chat.status === "paused_question") return "human";
  const t = `${chat.statusLine ?? ""} ${chat.title}`.toLowerCase();
  if (/windows|\brdp\b|\bpc\b/.test(t)) return "rdp";
  if (/brows|linkedin|website|\bweb\b|\bpage\b|https?:|\burl\b|google/.test(t)) return "browser";
  if (/\bmcp\b/.test(t)) return "mcp";
  if (/connector|gmail|slack|notion|e-?mail|inbox|\bapi\b/.test(t)) return "connector";
  if (/schedul|daily|weekly|cron|remind/.test(t)) return "schedule";
  if (/memory|remember/.test(t)) return "memory";
  if (/\bfiles?\b|csv|upload|download|folder/.test(t)) return "files";
  if (/shell|command|terminal|python|script/.test(t)) return "shell";
  if (/screen|desktop|computer|click|look/.test(t)) return "screen";
  return "think";
}

/** Short, non-ticking relative time — the row re-renders on refetch anyway. */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}
