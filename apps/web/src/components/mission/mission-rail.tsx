'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { CategoryTile, Dot, SegmentedSwitch, Skeleton } from '@/components/ui';
import type { RunState } from '@/hooks/use-run-stream';
import { MissionTab } from './mission-tab';
import { STATE_LABEL, useCapabilities } from '@/hooks/use-capabilities';
import styles from './mission-rail.module.css';

/** The screens view loads as its own chunk and stays mounted afterwards (see below). */
const ComputerTab = dynamic(() => import('./computer-tab').then((m) => m.ComputerTab), {
  loading: () => (
    <div role="status" aria-label="Loading computer view">
      <Skeleton shape="panel" height={220} />
    </div>
  ),
});
const LibraryTab = dynamic(() => import('./library-tab').then((m) => m.LibraryTab), {
  loading: () => (
    <div role="status" aria-label="Loading library">
      <Skeleton shape="panel" height={160} />
    </div>
  ),
});

/**
 * The right rail: a one-line identity header and three tabs. The body is ONE
 * scrolling column; panels inside size to their content and never shrink
 * (the old flex column collapsed them to their headers).
 */
type Tab = 'mission' | 'library' | 'computer';

const TABS = [
  { value: 'mission' as const, label: 'Mission' },
  { value: 'library' as const, label: 'Library' },
  { value: 'computer' as const, label: 'Computer' },
];

export function MissionRail({ run, chatId }: { run: RunState; chatId?: string | null }) {
  const [tab, setTab] = useState<Tab>('mission');

  const { capabilities, state, dot, workspace } = useCapabilities();

  return (
    <div className={styles.root}>
      <header className={styles.identity}>
        <CategoryTile cat="screen" size="lg" active={state === 'working'} />
        <div className={styles.idText}>
          <h2 className={styles.name}>Agent</h2>
          <p className={styles.sub} title={workspace?.sandboxId ?? undefined}>
            {workspace ? `workspace ${workspace.state}` : 'cloud workspace'}
          </p>
        </div>
        <span className={styles.state} data-state={state}>
          <Dot status={dot} size="sm" />
          {STATE_LABEL[state]}
        </span>
      </header>

      <SegmentedSwitch<Tab>
        label="Mission panel section"
        size="sm"
        variant="underline"
        value={tab}
        onChange={setTab}
        options={TABS}
        className={styles.tabs}
      />

      <div className={styles.body}>
        {tab === 'mission' && <MissionTab run={run} chatId={chatId} capabilities={capabilities} />}
        {tab === 'library' && (
          <LibraryTab
            chatId={chatId}
            running={run.phase === 'thinking' || run.phase === 'tool' || run.phase === 'waiting'}
          />
        )}
        {/* Always mounted: the live view keeps its connection while another tab shows. */}
        <div hidden={tab !== 'computer'} className={styles.computerHost}>
          <ComputerTab
            capabilities={capabilities}
            chatId={chatId}
            active={tab === 'computer'}
            steps={run.steps}
            runId={run.runId}
            onRequestOpen={() => setTab('computer')}
          />
        </div>
      </div>
    </div>
  );
}
