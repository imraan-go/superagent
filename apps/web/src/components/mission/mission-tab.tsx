'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CategoryTile, CountUp, Dot, Panel, Readout, SegmentedSwitch } from '@/components/ui';
import type { TileCategory } from '@/components/ui';
import { toolCategory } from '@/components/chat/parts/tool-meta';
import { formatCost } from '@/lib/format';
import { useUsageTicker } from '@/hooks/use-usage-ticker';
import type { UsageTotals } from '@/hooks/use-usage-ticker';
import type { RunState } from '@/hooks/use-run-stream';
import type { SystemStatus } from '@/hooks/use-capabilities';
import { WaitingPanel } from '@/components/hitl/waiting-panel';
import { clockTime, compactNumber, filterLog, mergeLog } from './rail-log';
import type { ChatStepInput, LhosEventInput, LogFilter } from './rail-log';
import styles from './mission-tab.module.css';

type Scope = 'today' | 'chat' | 'run';

const SCOPES = [
  { value: 'today' as const, label: 'Today' },
  { value: 'chat' as const, label: 'This chat' },
  { value: 'run' as const, label: 'This run' },
];

const FILTERS: { value: LogFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'chat', label: 'This run' },
  { value: 'computer', label: 'All runs' },
  { value: 'errors', label: 'Errors' },
];

const EVENTS_POLL_MS = 5_000;

/** Visible-tab flag: polling stops while the browser tab is hidden. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

function stampNow(): number {
  return Date.now();
}

/**
 * Mission tab — a live operations console: token & cost meter, stats strip,
 * "Waiting on you", and a merged activity log. Every token/cost figure comes
 * from `usage_events` rows (vendor-reported usage) via /api/usage/live; the
 * only exception is the in-flight run figure, marked `~`.
 */
export function MissionTab({
  run,
  chatId,
  capabilities,
}: {
  run: RunState;
  chatId?: string | null;
  capabilities?: SystemStatus;
}) {
  const { summary, live } = useUsageTicker(chatId, run.runId);
  const running = run.phase === 'thinking' || run.phase === 'tool' || run.phase === 'waiting';
  const [scope, setScope] = useState<Scope>('today');

  /* ---- meter ---- */
  const exactRun = summary?.run ?? null;
  // While streaming, the run stream's own (vendor-reported, per-step) figures
  // can be ahead of the persisted rows; show them, marked as provisional.
  const streamedAhead =
    running &&
    run.usage !== null &&
    (exactRun === null || run.usage.tokensIn + run.usage.tokensOut > exactRun.tokensIn + exactRun.tokensOut);
  const runTotals: UsageTotals | null =
    streamedAhead && run.usage
      ? {
          tokensIn: run.usage.tokensIn,
          tokensOut: run.usage.tokensOut,
          tokensCached: run.usage.cached,
          costUsd: run.usage.costUsd,
          calls: exactRun?.calls ?? 0,
          toolCalls: Math.max(exactRun?.toolCalls ?? 0, run.steps.filter((s) => s.type === 'tool').length),
        }
      : exactRun;
  const shown: UsageTotals | null =
    scope === 'today' ? (summary?.today ?? null) : scope === 'chat' ? (summary?.chat ?? null) : runTotals;
  const estimate = scope === 'run' && streamedAhead;
  const budget = summary?.budget ?? null;

  /* ---- stats ---- */
  const stats = summary?.stats;
  const successPct =
    stats && stats.toolOk + stats.toolFailed > 0
      ? Math.round((stats.toolOk / (stats.toolOk + stats.toolFailed)) * 100)
      : null;

  return (
    <>
      <Panel
        title="Tokens & cost"
        badge={
          <Dot status={live ? 'live' : 'idle'} size="sm" pulse={live && running} label={live ? 'Live' : 'Offline'} />
        }
        className={styles.meter}
      >
        <SegmentedSwitch<Scope>
          label="Usage scope"
          size="sm"
          value={scope}
          onChange={setScope}
          options={SCOPES}
          className={styles.scope}
        />
        {shown === null ? (
          <p className={styles.muted}>
            {scope === 'today'
              ? 'Connecting to the usage stream…'
              : scope === 'chat'
                ? 'Open a chat to see its usage.'
                : 'No run yet in this chat.'}
          </p>
        ) : (
          <>
            <div className={styles.headline}>
              <Readout
                label="cost"
                prefix="$"
                value={shown.costUsd}
                precision={4}
                size="md"
                tone="ok"
                estimate={estimate}
              />
              <span className={styles.calls}>
                {shown.calls} model · {shown.toolCalls} tool calls
              </span>
            </div>
            <dl className={styles.figures}>
              <Figure label="in" value={shown.tokensIn} estimate={estimate} />
              <Figure label="out" value={shown.tokensOut} estimate={estimate} />
              <Figure label="cached" value={shown.tokensCached} estimate={estimate} />
            </dl>
          </>
        )}
        {budget ? (
          <div className={styles.budget} data-state={budget.state}>
            <div
              className={styles.budgetTrack}
              role="meter"
              aria-label="Monthly budget used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.round(budget.pct))}
            >
              <span className={styles.budgetFill} style={{ width: `${Math.min(100, budget.pct)}%` }} />
            </div>
            <span className={styles.budgetText}>
              {formatCost(summary?.month?.costUsd ?? 0)} / {formatCost(budget.limitUsd)} this month ·{' '}
              {Math.round(budget.pct)}%
            </span>
          </div>
        ) : (
          summary && <p className={styles.muted}>No monthly limit set (Settings › Usage &amp; budget).</p>
        )}
      </Panel>

      <ul className={styles.stats} aria-label="Stats">
        <Stat cat="agent" label="avg tool" num={stats?.avgToolMs ?? null} unit="ms" />
        <Stat
          cat="money"
          label="success"
          num={successPct}
          unit="%"
          tone={successPct !== null && successPct < 90 ? 'warn' : undefined}
        />
        <Stat cat="think" label="steps run" num={run.steps.length} />
        <Stat
          cat="screen"
          label="workspace"
          value={capabilities ? (capabilities.workspaces.find((w) => w.kind === 'code')?.state ?? 'idle') : '…'}
          tone={capabilities?.workspaces.some((w) => w.kind === 'code' && w.state === 'running') ? 'ok' : undefined}
        />
        <Stat cat="connector" label="apps" num={capabilities ? capabilities.connectedApps : null} />
        <Stat
          cat="schedule"
          label="worker"
          value={capabilities ? (capabilities.worker === 'ok' ? 'running' : 'stalled') : '…'}
          tone={capabilities?.worker === 'stalled' ? 'warn' : 'ok'}
        />
      </ul>

      <WaitingPanel />

      <ActivityLog run={run} chatId={chatId} />
    </>
  );
}

function Figure({ label, value, estimate }: { label: string; value: number; estimate: boolean }) {
  return (
    <div className={styles.figure}>
      <dt>{label}</dt>
      <dd title={value.toLocaleString()}>
        {estimate && <span aria-label="approximately">~</span>}
        <CountUp value={value} format={(n) => compactNumber(Math.round(n))} />
      </dd>
    </div>
  );
}

function Stat({
  cat,
  label,
  value,
  num,
  unit = '',
  tone,
}: {
  cat: TileCategory;
  label: string;
  value?: string;
  /** Numeric stats count up; null renders a dash. */
  num?: number | null;
  unit?: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <li className={styles.stat} data-tone={tone}>
      <CategoryTile cat={cat} size="xs" className={styles.statIcon} />
      <span className={styles.statValue}>
        {num === undefined ? (
          value
        ) : num === null ? (
          '–'
        ) : (
          <>
            <CountUp value={num} />
            {unit}
          </>
        )}
      </span>
      <span className={styles.statLabel}>{label}</span>
    </li>
  );
}

function ActivityLog({ run, chatId }: { run: RunState; chatId?: string | null }) {
  const pageVisible = usePageVisible();
  const [filter, setFilter] = useState<LogFilter>('all');
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);

  const { data: eventsData, isError } = useQuery<{ events: LhosEventInput[] }>({
    queryKey: ['activity', 'rail'],
    queryFn: async () => {
      const res = await fetch('/api/activity?limit=80', { cache: 'no-store' });
      if (!res.ok) throw new Error(`activity ${res.status}`);
      return (await res.json()) as { events: LhosEventInput[] };
    },
    refetchInterval: pageVisible ? EVENTS_POLL_MS : false,
    retry: false,
  });

  // The run stream carries no timestamps; stamp each step when first seen.
  // (Adjust-state-during-render pattern: stamps are set once, then stable.)
  const [seen, setSeen] = useState<Record<string, number>>({});
  const stepKey = (idx: number) => `${run.runId ?? ''}:${idx}`;
  const unseen = run.steps.filter((s) => seen[stepKey(s.idx)] === undefined);
  if (unseen.length > 0) {
    const now = stampNow();
    setSeen((prev) => {
      const next = { ...prev };
      for (const s of unseen) next[stepKey(s.idx)] ??= now;
      return next;
    });
  }
  const steps: ChatStepInput[] = run.steps.map((s) => ({
    idx: s.idx,
    toolName: s.toolName,
    label: s.label,
    ok: s.ok,
    ms: s.ms,
    type: s.type,
    seenAt: seen[stepKey(s.idx)] ?? 0,
  }));

  const entries = useMemo(
    () => filterLog(mergeLog(steps, eventsData?.events ?? [], run.runId), filter),
    [steps, eventsData, run.runId, filter],
  );

  // Auto-follow: newest is on top, so following = staying scrolled to the top.
  const newest = entries[0]?.key;
  useEffect(() => {
    if (follow && listRef.current) listRef.current.scrollTop = 0;
  }, [follow, newest]);

  return (
    <Panel
      title="Activity"
      badge={<Dot status={run.phase === 'idle' ? 'idle' : 'live'} size="sm" pulse={run.phase !== 'idle'} />}
      actions={
        <label className={styles.follow}>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow
        </label>
      }
    >
      <div className={styles.chips} role="group" aria-label="Filter activity">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={styles.chip}
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <p className={styles.muted}>
          {filter === 'errors'
            ? 'No errors.'
            : filter === 'chat' && !chatId
              ? 'Open a chat to see its steps.'
              : isError && filter === 'computer'
                ? 'Could not load recent activity.'
                : 'Nothing yet.'}
        </p>
      ) : (
        <ol
          ref={listRef}
          className={styles.log}
          aria-live={follow ? 'polite' : 'off'}
          aria-relevant="additions"
          onScroll={(e) => {
            if (e.currentTarget.scrollTop > 24 && follow) setFollow(false);
          }}
        >
          {entries.map((e, i) => (
            <li
              key={e.key}
              className={`${styles.entry} rise-in`}
              data-ok={e.ok === null ? 'pending' : String(e.ok)}
              style={{ '--i': i } as React.CSSProperties}
            >
              <time className={styles.ts} dateTime={new Date(e.ts).toISOString()}>
                {clockTime(e.ts)}
              </time>
              <span className={styles.entryIcon}>
                <CategoryTile cat={toolCategory(e.tool)} size="xs" active={e.ok === null} />
                <Dot
                  status={e.ok === null ? 'pending' : e.ok ? 'ok' : 'error'}
                  size="sm"
                  pulse={e.ok === null}
                  className={styles.entryDot}
                />
              </span>
              <span className={styles.src} data-src={e.source}>
                {e.source === 'chat' ? 'now' : 'run'}
              </span>
              <span className={styles.what} title={e.detail ?? e.label}>
                <span className={styles.tool}>{e.tool}</span>
                {e.label && e.label !== e.tool && e.label !== e.tool.replace(/_/g, ' ') && (
                  <span className={styles.label}>{e.label}</span>
                )}
              </span>
              <span className={styles.ms}>{e.ms !== null ? `${e.ms}ms` : ''}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
