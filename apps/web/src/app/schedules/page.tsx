'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, fmtTime } from '../../lib/api';

interface Schedule {
  id: string;
  name: string;
  prompt: string;
  spec: { kind: 'cron'; cron: string } | { kind: 'interval'; everyMinutes: number };
  timezone: string;
  state: string;
  readOnly: boolean;
  createdAt: string;
}

export default function SchedulesPage() {
  const [items, setItems] = useState<Schedule[]>([]);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<'cron' | 'interval'>('cron');
  const [cron, setCron] = useState('0 8 * * 1-5');
  const [every, setEvery] = useState(60);
  const [tz, setTz] = useState('UTC');
  const [error, setError] = useState('');

  const load = useCallback(async () => setItems((await api<{ schedules: Schedule[] }>('/api/schedules')).schedules), []);
  useEffect(() => {
    setTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    void load();
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/api/schedules', { method: 'POST', body: { name, prompt, timezone: tz, spec: kind === 'cron' ? { kind, cron } : { kind, everyMinutes: every } } });
      setName('');
      setPrompt('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create schedule');
    }
  };
  const act = async (id: string, what: 'pause' | 'resume' | 'delete') => {
    await api(what === 'delete' ? `/api/schedules/${id}` : `/api/schedules/${id}/${what}`, { method: what === 'delete' ? 'DELETE' : 'POST', body: what === 'delete' ? undefined : {} });
    await load();
  };

  return (
    <>
      <h1>Schedules</h1>
      <form className="card" onSubmit={submit}>
        <div className="notice small">Scheduled runs are read-only: they can read and prepare, but never send or change anything externally.</div>
        <label htmlFor="sname">Name</label>
        <input id="sname" value={name} onChange={(e) => setName(e.target.value)} required />
        <label htmlFor="sprompt">Instructions</label>
        <textarea id="sprompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
        <div className="row">
          <div style={{ flex: 1 }}>
            <label htmlFor="skind">Repeat</label>
            <select id="skind" value={kind} onChange={(e) => setKind(e.target.value as 'cron' | 'interval')}>
              <option value="cron">Cron expression</option>
              <option value="interval">Every N minutes</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="sspec">{kind === 'cron' ? 'Cron (min hour dom mon dow)' : 'Minutes (≥ 5)'}</label>
            {kind === 'cron' ? <input id="sspec" value={cron} onChange={(e) => setCron(e.target.value)} /> : <input id="sspec" type="number" min={5} value={every} onChange={(e) => setEvery(Number(e.target.value))} />}
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="stz">Timezone (IANA)</label>
            <input id="stz" value={tz} onChange={(e) => setTz(e.target.value)} />
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <div style={{ marginTop: 12 }}>
          <button type="submit">Create schedule</button>
        </div>
      </form>
      {items.map((s) => (
        <div className="card" key={s.id}>
          <div className="row spread">
            <strong>{s.name}</strong>
            <span className={`badge ${s.state}`}>{s.state.replace('_', ' ')}</span>
          </div>
          <div className="small muted">
            {s.spec.kind === 'cron' ? `cron ${s.spec.cron}` : `every ${s.spec.everyMinutes} min`} · {s.timezone} · created {fmtTime(s.createdAt)}
          </div>
          <div style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }}>{s.prompt}</div>
          <div className="row">
            {s.state === 'paused' ? (
              <button className="secondary" onClick={() => void act(s.id, 'resume')}>
                Resume
              </button>
            ) : (
              <button className="secondary" onClick={() => void act(s.id, 'pause')}>
                Pause
              </button>
            )}
            <button className="danger" onClick={() => void act(s.id, 'delete')}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
