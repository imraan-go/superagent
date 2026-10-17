'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { CalendarCheck, ChartLine, Cube, Gauge, Tray } from '@phosphor-icons/react/dist/ssr';
import { Skeleton, SkeletonText, ToastProvider } from '@/components/ui';
import { cn } from '@/lib/cn';
import { MANAGE_SECTION_EVENT, consumePendingManageSection } from '@/lib/app-events';
import styles from './manage-view.module.css';

/** Section-shaped placeholder: heading, a line of copy, then a card grid. */
function SectionSkeleton() {
  return (
    <div role="status" aria-label="Loading section" className={styles.sectionSkeleton}>
      <Skeleton shape="text" width="30%" height={24} />
      <SkeletonText lines={2} />
      <div className={styles.sectionSkeletonGrid}>
        <Skeleton shape="panel" height={140} />
        <Skeleton shape="panel" height={140} />
        <Skeleton shape="panel" height={140} />
        <Skeleton shape="panel" height={140} />
      </div>
    </div>
  );
}

/** Every section is its own chunk; the view opens on Overview and loads the rest on demand. */
const Overview = dynamic(() => import('./overview').then((m) => m.Overview), { loading: SectionSkeleton });
const Workspaces = dynamic(() => import('./workspaces').then((m) => m.Workspaces), { loading: SectionSkeleton });
const Activity = dynamic(() => import('./activity').then((m) => m.Activity), { loading: SectionSkeleton });
const Inbox = dynamic(() => import('./inbox').then((m) => m.Inbox), { loading: SectionSkeleton });
const Routines = dynamic(() => import('@/components/settings/tabs/schedules-tab').then((m) => m.SchedulesTab), {
  loading: SectionSkeleton,
});

/**
 * Workspaces: health of what the agent depends on, your E2B sandboxes, activity across runs, the
 * inbox of questions and approvals, and routines. Destructive actions are hold-to-confirm.
 */
type Section = 'overview' | 'sandboxes' | 'activity' | 'inbox' | 'routines';

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Gauge }> = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'sandboxes', label: 'Sandboxes', icon: Cube },
  { id: 'activity', label: 'Activity', icon: ChartLine },
  { id: 'inbox', label: 'Inbox', icon: Tray },
  { id: 'routines', label: 'Routines', icon: CalendarCheck },
];

/** Section ids + labels for the command palette. */
export const MANAGE_SECTION_LIST = SECTIONS.map(({ id, label }) => ({ id, label }));

const isSection = (id: unknown): id is Section => SECTIONS.some((s) => s.id === id);

export function ManageView() {
  // A palette deep-link queued before this mounted wins the initial section.
  const [section, setSection] = useState<Section>(() => {
    const queued = consumePendingManageSection();
    return isSection(queued) ? queued : 'overview';
  });

  // Live deep-links while Manage is already open.
  useEffect(() => {
    const onSection = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (isSection(id)) setSection(id);
      consumePendingManageSection();
    };
    window.addEventListener(MANAGE_SECTION_EVENT, onSection);
    return () => window.removeEventListener(MANAGE_SECTION_EVENT, onSection);
  }, []);

  // `/manage?section=inbox` is the deep link behind the topbar waiting badge.
  const requested = useSearchParams().get('section');
  const [seenRequest, setSeenRequest] = useState<string | null>(null);
  if (requested !== seenRequest) {
    setSeenRequest(requested);
    const match = SECTIONS.find((s) => s.id === requested);
    if (match) setSection(match.id);
  }

  return (
    <ToastProvider>
      <div className={styles.root}>
        <nav className={styles.nav} aria-label="Workspaces sections">
          <p className={styles.navLabel}>Workspaces</p>
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={cn(styles.navItem, section === item.id && styles.navItemActive)}
                aria-current={section === item.id ? 'page' : undefined}
                onClick={() => setSection(item.id)}
              >
                <Icon size={16} weight={section === item.id ? 'fill' : 'regular'} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <main id="main" tabIndex={-1} className={styles.main}>
          {section === 'overview' && <Overview />}
          {section === 'sandboxes' && <Workspaces />}
          {section === 'activity' && <Activity />}
          {section === 'inbox' && <Inbox />}
          {section === 'routines' && <Routines />}
        </main>
      </div>
    </ToastProvider>
  );
}
