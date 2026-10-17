'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Trash } from '@phosphor-icons/react/dist/ssr';
import { Button, Dot, HoldToConfirm, Panel, useToast } from '@/components/ui';
import type { DotStatus } from '@/components/ui/dot';
import { STATUS_KEY } from '@/hooks/use-capabilities';
import type { WorkspaceView } from '@/hooks/use-capabilities';
import { useSettingsSection } from '@/hooks/use-settings';
import { apiGet, apiPost } from './api';
import { ErrorNote, SectionHeader, SkeletonRows, formatDuration, formatWhen } from './shared';
import styles from './shared.module.css';

const KEY = ['manage', 'workspaces'] as const;

const STATE_DOT: Record<WorkspaceView['state'], DotStatus> = {
  creating: 'pending',
  running: 'live',
  paused: 'idle',
  killed: 'idle',
  lost: 'error',
  failed: 'error',
};

/**
 * Workspaces → Sandboxes: the owner's E2B sandboxes. The code workspace is reused across runs
 * (paused between them so files persist); each run's browser is disposable. Pause and destroy
 * are queued to the worker, which holds the E2B leases.
 */
export function Workspaces() {
  const qc = useQueryClient();
  const toast = useToast();
  const manage = useSettingsSection('manage');
  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => (await apiGet<{ workspaces: WorkspaceView[] }>('/api/workspaces')).workspaces,
    refetchInterval: manage.value.statsPollSeconds * 1000,
  });
  const act = useMutation({
    mutationFn: (v: { id: string; op: 'pause' | 'kill' }) => apiPost(`/api/workspaces/${v.id}/${v.op}`),
    onSuccess: (_r, v) => {
      toast.push({ title: v.op === 'pause' ? 'Pausing the sandbox' : 'Destroying the sandbox', tone: 'info' });
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (e: Error) => toast.push({ title: 'Sandbox action failed', message: e.message, tone: 'error' }),
  });

  const live = (query.data ?? []).filter((w) => w.state !== 'killed');
  const gone = (query.data ?? []).filter((w) => w.state === 'killed').slice(0, 10);

  return (
    <div className={styles.stack}>
      <SectionHeader title="Sandboxes">
        Your private E2B sandboxes. Sandboxes in use by a run cannot be paused or destroyed until it ends.
      </SectionHeader>
      {query.isError && !query.data && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}
      {!query.data && !query.isError && <SkeletonRows rows={3} height={96} />}
      {query.data && live.length === 0 && (
        <p className={styles.empty}>No sandboxes yet. They start the first time the agent needs one.</p>
      )}
      <div className={styles.grid}>
        {live.map((w) => (
          <Panel
            key={w.id}
            title={<span className={styles.svcName}>{w.kind === 'code' ? 'Code workspace' : 'Browser'}</span>}
            badge={<Dot status={STATE_DOT[w.state]} pulse={w.state === 'running'} label={w.state} />}
          >
            <dl className={styles.svcFacts}>
              <dt>sandbox</dt>
              <dd className={styles.mono}>{w.sandboxId ? w.sandboxId.slice(0, 16) : '—'}</dd>
              <dt>scope</dt>
              <dd>{w.scope === 'user' ? 'reused across runs' : 'one run'}</dd>
              <dt>active</dt>
              <dd>{formatDuration(w.activeMs)}</dd>
              <dt>last used</dt>
              <dd>{formatWhen(w.lastActiveAt)}</dd>
              {w.lastError && (
                <>
                  <dt>last error</dt>
                  <dd title={w.lastError}>{w.lastError.slice(0, 80)}</dd>
                </>
              )}
            </dl>
            <div className={styles.row}>
              {w.state === 'running' && (
                <Button
                  size="sm"
                  variant="outline"
                  iconLeft={<Pause size={14} />}
                  disabled={act.isPending}
                  onClick={() => act.mutate({ id: w.id, op: 'pause' })}
                >
                  Pause
                </Button>
              )}
              <HoldToConfirm
                size="sm"
                tone="danger"
                holdMs={manage.value.confirmHoldMs}
                disabled={act.isPending}
                icon={<Trash size={14} />}
                label="Destroy this sandbox (hold to confirm)"
                onConfirm={() => act.mutate({ id: w.id, op: 'kill' })}
              >
                Destroy
              </HoldToConfirm>
            </div>
          </Panel>
        ))}
      </div>
      {gone.length > 0 && (
        <p className={styles.meta}>
          Recently destroyed: {gone.map((w) => `${w.kind} ${formatWhen(w.lastActiveAt ?? w.createdAt)}`).join(' · ')}
        </p>
      )}
    </div>
  );
}
