'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bell } from '@phosphor-icons/react/dist/ssr';
import { useToast } from '@/components/ui';
import { usePending } from '@/hooks/use-pending';
import { useSound } from '@/hooks/use-sound';
import { useDesktopNotify } from '@/hooks/use-desktop-notify';
import { newItems } from '@/lib/hitl';
import type { PendingItem } from '@/lib/hitl';
import styles from './hitl.module.css';

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
  const [spoken, setSpoken] = useState('');

  useEffect(() => {
    if (!data) return;
    const fresh = newItems(previous.current, data.items);
    previous.current = data.items;

    if (fresh.length > 0) {
      // Assertive: something is blocked on the owner. Toasts also announce, but
      // they vanish; this region is the guaranteed SR path.
      setSpoken(
        fresh.length === 1
          ? `New request waiting on you: ${fresh[0]!.prompt}`
          : `${fresh.length} new requests waiting on you.`,
      );
    }

    for (const item of fresh.slice(0, 3)) {
      const href = item.chatId ? `/chat/${item.chatId}` : undefined;
      const title = item.kind === 'ask' ? 'The agent has a question' : 'Approval needed';
      sound('approval');
      notify(item.kind === 'ask' ? 'question' : 'approval', title, item.prompt || title, href);
      toast.push({
        title,
        message: item.prompt,
        tone: 'warning',
        durationMs: 8_000,
        action: href ? { label: 'Review', onClick: () => router.push(href) } : undefined,
      });
    }
  }, [data, notify, router, sound, toast]);

  return (
    <p className="sr-only" role="status" aria-live="assertive" aria-atomic="true">
      {spoken}
    </p>
  );
}

/** Topbar count of everything waiting on the owner. */
export function PendingBadge() {
  const { data } = usePending();
  const router = useRouter();
  const manage = usePathname().startsWith('/manage');
  const count = data?.count ?? 0;
  if (count === 0) return null;

  const first = data?.items.find((i) => i.chatId);
  const label = `${count} item${count === 1 ? '' : 's'} waiting on you`;

  return (
    <button
      type="button"
      className={styles.badge}
      aria-label={label}
      title={label}
      onClick={() => {
        // In Workspaces the badge opens the inbox; elsewhere the oldest chat waiting.
        if (manage || !first?.chatId) router.push('/manage?section=inbox');
        else router.push(`/chat/${first.chatId}`);
      }}
    >
      <Bell size={16} weight="duotone" aria-hidden />
      <span className={styles.badgeCount}>{count > 99 ? '99+' : count}</span>
    </button>
  );
}
