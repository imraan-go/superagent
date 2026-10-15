"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gear, MagnifyingGlass, Plus, PushPin, Trash } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { ChatSummary } from "@/lib/api";
import { groupChats } from "@/lib/chat-groups";
import { Dot, IconButton, SkeletonText } from "@/components/ui";
import { cn } from "@/lib/cn";
import styles from "./chat-sidebar.module.css";

/**
 * Chat history. Each row carries a live status line under its title, so the
 * owner can see what every chat is doing without opening it
 * (DESIGN_SYSTEM §Reference reading).
 */
export function ChatSidebar({
  activeId,
  onOpenSettings,
}: {
  activeId?: string;
  onOpenSettings: () => void;
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
    <div className={styles.root}>
      <div className={styles.header}>
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
        <IconButton
          label="New chat"
          icon={<Plus size={16} weight="bold" />}
          onClick={() => createChat.mutate()}
          disabled={createChat.isPending}
        />
      </div>

      <nav className={styles.list} aria-label="Chat history">
        {isPending ? (
          <div className={styles.loading}>
            <SkeletonText lines={5} />
          </div>
        ) : filtered.length === 0 ? (
          <p className={styles.empty}>
            {query ? "No chats match that." : "No chats yet. Start one above."}
          </p>
        ) : (
          groups.map((group) => (
            <Section key={group.key} label={group.label}>
              {group.chats.map((chat) => (
                <ChatRow key={chat.id} chat={chat} active={chat.id === activeId} />
              ))}
            </Section>
          ))
        )}
      </nav>

      <div className={styles.footer}>
        <button type="button" className={styles.settings} onClick={onOpenSettings}>
          <Gear size={16} weight="duotone" aria-hidden />
          Settings
        </button>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>{label}</h2>
      {children}
    </section>
  );
}

function ChatRow({ chat, active }: { chat: ChatSummary; active: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["chats"] });

  const pin = useMutation({
    mutationFn: () => api.updateChat(chat.id, { pinned: !chat.pinned }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => api.deleteChat(chat.id),
    onSuccess: async () => {
      await invalidate();
      if (active) router.push("/");
    },
  });

  return (
    <div className={cn(styles.row, active && styles.rowActive)}>
      <Link href={`/chat/${chat.id}`} className={styles.rowLink} aria-current={active ? "page" : undefined}>
        <span className={styles.rowTitle}>{chat.title}</span>
        <span className={styles.rowMeta}>
          {chat.statusLine ? (
            <>
              <Dot
                status={statusDot(chat.status)}
                size="sm"
                pulse={chat.status === "running"}
              />
              <span className={styles.rowStatus}>{chat.statusLine}</span>
            </>
          ) : (
            <span className={styles.rowTime}>{relativeTime(chat.updatedAt)}</span>
          )}
        </span>
      </Link>

      <span className={styles.rowActions}>
        <IconButton
          label={chat.pinned ? "Unpin chat" : "Pin chat"}
          size="sm"
          icon={<PushPin size={13} weight={chat.pinned ? "fill" : "regular"} />}
          onClick={() => pin.mutate()}
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
    </div>
  );
}

function statusDot(status: string | null) {
  switch (status) {
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
