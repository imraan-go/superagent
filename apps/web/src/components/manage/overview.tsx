'use client';

import { Dot, Panel } from '@/components/ui';
import type { DotStatus } from '@/components/ui/dot';
import { STATE_LABEL, useCapabilities } from '@/hooks/use-capabilities';
import { ErrorNote, SectionHeader, SkeletonRows } from './shared';
import styles from './shared.module.css';

const PARTS: Array<{ key: string; name: string; what: string }> = [
  { key: 'gateway', name: 'Model gateway', what: 'Vercel AI Gateway: every model call' },
  { key: 'temporal', name: 'Temporal', what: 'Durable runs, questions, approvals and routines' },
  { key: 'e2b_code', name: 'Cloud workspace', what: 'E2B sandbox for Python and files' },
  { key: 'e2b_browser', name: 'Cloud browser', what: 'Google Chrome in E2B, approved sites only' },
  { key: 'composio', name: 'Connected apps', what: 'Composio accounts (Gmail, Calendar, …)' },
  { key: 'storage', name: 'File storage', what: 'S3/MinIO for screenshots, exports and uploads' },
  { key: 'budget', name: 'Budget caps', what: 'Per-run and monthly spend limits' },
];

/** Workspaces → Overview: is everything the agent depends on configured and running? */
export function Overview() {
  const { capabilities: c, state, dot, isError } = useCapabilities();

  return (
    <div className={styles.stack}>
      <SectionHeader title="Overview">What the agent depends on, and whether it can run right now.</SectionHeader>
      {isError && !c && <ErrorNote error={new Error('Could not load the server status.')} />}
      {!c && !isError && <SkeletonRows rows={4} height={64} />}
      {c && (
        <>
          <div className={styles.grid}>
            <Panel title="Agent" badge={<Dot status={dot} pulse={state === 'working'} label={STATE_LABEL[state]} />}>
              <dl className={styles.svcFacts}>
                <dt>worker</dt>
                <dd>{c.worker === 'ok' ? 'draining the queue' : 'not running — start it with pnpm worker:dev'}</dd>
                <dt>running</dt>
                <dd>{c.running}</dd>
                <dt>waiting on you</dt>
                <dd>
                  {c.pending.questions} question{c.pending.questions === 1 ? '' : 's'} · {c.pending.approvals} approval
                  {c.pending.approvals === 1 ? '' : 's'}
                </dd>
                <dt>connected apps</dt>
                <dd>{c.connectedApps}</dd>
              </dl>
            </Panel>
            {PARTS.filter((p) => c.capabilities[p.key]).map((p) => {
              const v = c.capabilities[p.key]!;
              const status: DotStatus = v.configured ? 'ok' : 'warn';
              return (
                <Panel
                  key={p.key}
                  title={p.name}
                  badge={<Dot status={status} label={v.configured ? 'ready' : 'not set up'} />}
                >
                  <p className={styles.meta}>{p.what}</p>
                  {!v.configured && (
                    <p className={styles.meta}>
                      Set on the server: <span className={styles.mono}>{v.missing.join(', ')}</span>
                    </p>
                  )}
                </Panel>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
