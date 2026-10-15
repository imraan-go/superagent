'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, fmtTime, type Task } from '../lib/api';

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [prompt, setPrompt] = useState('');
  const [domains, setDomains] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ tasks: Task[] }>('/api/tasks');
    setTasks(r.tasks);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const allowedDomains = domains.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
      const r = await api<{ task: Task }>('/api/tasks', { method: 'POST', body: { prompt, allowedDomains, idempotencyKey: crypto.randomUUID(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      window.location.href = `/tasks/${r.task.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create task');
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Tasks</h1>
      <form className="card" onSubmit={submit}>
        <label htmlFor="prompt">What should the assistant do?</label>
        <textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Summarise my calendar for tomorrow and draft a reply to Sam (I'll approve before anything is sent)" required />
        <label htmlFor="domains">Approved browsing domains (optional, comma separated)</label>
        <input id="domains" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="example.com, *.wikipedia.org" />
        {error && <div className="error">{error}</div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="submit" disabled={busy || !prompt.trim()}>
            Start task
          </button>
          <span className="muted small">External changes (sending, sharing, uploads) always wait for your exact approval.</span>
        </div>
      </form>

      <h2>Recent</h2>
      <div className="card">
        {tasks.length === 0 ? (
          <div className="muted">No tasks yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/tasks/${t.id}`}>{t.title}</Link>
                    {t.origin === 'schedule' && <span className="muted small"> · scheduled</span>}
                  </td>
                  <td>
                    <span className={`badge ${t.status}`}>{t.status.replace('_', ' ')}</span>
                  </td>
                  <td className="muted small">{fmtTime(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
