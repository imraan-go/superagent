"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "@phosphor-icons/react/dist/ssr";
import { useToast } from "@/components/ui";
import { usePending } from "@/hooks/use-pending";
import { useSound } from "@/hooks/use-sound";
import { useDesktopNotify } from "@/hooks/use-desktop-notify";
import { OPEN_COMPUTER_EVENT, newItems } from "@/lib/hitl";
import type { PendingItem } from "@/lib/hitl";
import styles from "./hitl.module.css";

/**
 * App-wide watcher: announces each new item waiting on the owner exactly once
 * — toast, sound cue, and a Chrome notification when the tab is in the
 * background. Mounted once in the app shell so it works on every route.
 */
export function HitlWatcher() {
  const { data } = usePending();
  const toast = useToast();
  const sound = useSound();
  const { notify } = useDesktopNotify();
  const router = useRouter();
  const previous = useRef<PendingItem[] | undefined>(undefined);

  useEffect(() => {
    if (!data) return;
    const fresh = newItems(previous.current, data.items);
    previous.current = data.items;

    for (const item of fresh.slice(0, 3)) {
      const href = item.chatId ? `/chat/${item.chatId}` : undefined;
      const takeover = item.kind === "takeover";
      const title = takeover
        ? "The agent needs you on the computer"
        : item.kind === "ask"
          ? "The agent has a question"
          : "Approval needed";

      sound(takeover ? "takeover" : "approval");
      notify(takeover ? "takeover" : "approval", title, item.prompt || title, href);
      toast.push({
        title,
        message: item.prompt,
        tone: "warning",
        durationMs: 8_000,
        action: takeover
          ? {
              label: "Open computer",
              onClick: () => window.dispatchEvent(new CustomEvent(OPEN_COMPUTER_EVENT)),
            }
          : href
            ? { label: "Review", onClick: () => router.push(href) }
            : undefined,
      });
    }
  }, [data, notify, router, sound, toast]);

  return null;
}

/** Topbar count of everything waiting on the owner. */
export function PendingBadge() {
  const { data } = usePending();
  const router = useRouter();
  const count = data?.count ?? 0;
  if (count === 0) return null;

  const first = data?.items.find((i) => i.chatId);
  const label = `${count} item${count === 1 ? "" : "s"} waiting on you`;

  return (
    <button
      type="button"
      className={styles.badge}
      aria-label={label}
      title={label}
      onClick={() => {
        if (first?.chatId) router.push(`/chat/${first.chatId}`);
      }}
    >
      <Bell size={16} weight="duotone" aria-hidden />
      <span className={styles.badgeCount}>{count > 99 ? "99+" : count}</span>
    </button>
  );
}
