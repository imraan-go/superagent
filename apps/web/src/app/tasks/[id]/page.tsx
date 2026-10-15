'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApprovalCard } from '../../../components/approval-card';
import { api, fmtTime, type Approval, type Artifact, type Task, type TaskEvent } from '../../../lib/api';

const LABELS: Record<string, (d: Record<string, unknown>) => string> = {
  'task.queued': () => 'Queued',
  'task.started': () => 'Started',
  'model.decision': (d) => {
    const tools = (d.tools as Array<{ name: string }> | undefined)?.map((t) => t.name).join(', ');
    const cost = d.costUsd ? ` · $${d.costUsd as string}` : '';
    return d.outcome === 'rejected_partial' ? `Model output rejected (${d.reason as string})` : tools ? `Planned: ${tools}${cost}` : `Answered${cost}`;
  },
  'tool.started': (d) => `Running ${d.tool as string}`,
  'tool.completed': (d) => `${d.tool as string}: ${d.summary as string}`,
  'tool.failed': (d) => `${d.tool as string} failed: ${(d.summary ?? d.reason) as string}`,
  'tool.denied': (d) => `${d.tool as string} denied: ${d.reason as string}`,
  'approval.requested': (d) => `Waiting for your approval: ${d.tool as string}`,
  'approval.decided': (d) => `Approval ${d.decision as string}`,
  'approval.expired': () => 'Approval expired — nothing was done',
  'action.attempted': (d) => `Executing approved ${d.tool as string}`,
  'action.confirmed': (d) => `Confirmed by provider: ${d.tool as string}`,
  'action.failed': (d) => `Action failed: ${d.reason as string}`,
  'action.unknown_outcome': () => 'Outcome UNKNOWN — check your account before retrying',
  'artifact.created': (d) => `Saved file ${d.name as string}`,
  'browser.started': (d) => `Cloud browser: ${d.browser as string}`,
  'workspace.created': () => 'Workspace created',
  'workspace.resumed': () => 'Workspace resumed',
  'workspace.paused': () => 'Workspace paused',
  'workspace.lost': () => 'Previous workspace expired; started a fresh one (exported files are safe)',
  'budget.blocked': (d) => `Stopped by budget: ${d.reason as string}`,
  'connection.expired': (d) => `${d.toolkit as string} connection needs reconnecting`,
  'task.completed': () => 'Completed',
  'task.failed': (d) => `Failed${d.reason ? `: ${d.reason as string}` : ''}`,
  'task.cancelled': () => 'Cancelled',
};

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [intents, setIntents] = useState<Approval[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api<{ task: Task; events: TaskEvent[]; artifacts: Artifact[]; intents: Approval[] }>(`/api/tasks/${id}`);
      setTask(r.task);
      setEvents(r.events);
      setArtifacts(r.artifacts);
      setIntents(r.intents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Not found');
    }
  }, [id]);

  useEffect(() => {
    void load();
    const es = new EventSource(`/api/tasks/${id}/stream`);
    es.addEventListener('task', () => void load());
    es.addEventListener('status', (m) => {
      const s = JSON.parse((m as MessageEvent).data as string) as { status: string };
      setTask((t) => (t && t.status !== s.status ? { ...t, status: s.status } : t));
    });
    return () => es.close();
  }, [id, load]);

  if (error) return <div className="error">{error}</div>;
  if (!task) return <div className="muted">Loading…</div>;
  const running = ['queued', 'running', 'waiting_approval'].includes(task.status);
  const pending = intents.filter((i) => i.status === 'pending_approval' && new Date(i.expiresAt).getTime() > Date.now());

  return (
    <>
      <div className="row spread">
        <h1>{task.title}</h1>
        <div className="row">
          <span className={`badge ${task.status}`} data-testid="task-status">
            {task.status.replace('_', ' ')}
          </span>
          {running && (
            <button className="secondary" onClick={() => void api(`/api/tasks/${id}/cancel`, { method: 'POST', body: {} }).then(load)}>
              Cancel
            </button>
          )}
        </div>
      </div>
      <div className="card">
        <div className="muted small">Request</div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{task.prompt}</div>
        {task.allowedDomains.length > 0 && <div className="muted small">Approved domains: {task.allowedDomains.join(', ')}</div>}
        {task.readOnly && <div className="muted small">Read-only run: external changes are not permitted.</div>}
      </div>

      {pending.map((a) => (
        <ApprovalCard key={a.id} a={a} onDone={load} />
      ))}

      {(task.resultSummary || task.error) && (
        <div className="card">
          <div className="muted small">{task.error ? 'Problem' : 'Result'}</div>
          <div style={{ whiteSpace: 'pre-wrap' }} data-testid="task-result">
            {task.error ?? task.resultSummary}
          </div>
        </div>
      )}

      {artifacts.length > 0 && (
        <>
          <h2>Files</h2>
          {artifacts.map((a) => (
            <div className="card" key={a.id}>
              <div className="row spread">
                <a href={`/api/artifacts/${a.id}/download`}>{a.name}</a>
                <span className="muted small">
                  {a.contentType} · {a.sizeBytes} bytes · sha256 {a.sha256.slice(0, 12)}…
                </span>
              </div>
              {typeof a.source.url === 'string' && <div className="muted small">Source: {a.source.url}</div>}
              {(a.contentType === 'image/png' || a.contentType === 'image/jpeg') && (
                <img className="shot" src={`/api/artifacts/${a.id}/download?inline=1`} alt={a.name} />
              )}
            </div>
          ))}
        </>
      )}

      <h2>Activity</h2>
      <div className="card">
        <ul className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <span className="muted small">{fmtTime(e.createdAt)} · </span>
              {(LABELS[e.type] ?? (() => e.type))(e.data)}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
