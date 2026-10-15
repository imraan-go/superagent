'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, fmtTime } from '../../lib/api';

interface Connection {
  id: string;
  toolkit: string;
  status: string;
  label: string | null;
  lastVerifiedAt: string | null;
}

const TOOLKITS = [
  ['github', 'GitHub', 'Read your profile and repositories'],
  ['googlecalendar', 'Google Calendar', 'Read your events'],
  ['googledrive', 'Google Drive', 'Find files'],
  ['gmail', 'Gmail', 'Read mail; drafts and sends need your approval'],
] as const;

export default function ConnectionsPage() {
  const [items, setItems] = useState<Connection[]>([]);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const load = useCallback(async () => setItems((await api<{ connections: Connection[] }>('/api/connections')).connections), []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('result')) setBanner(`${q.get('toolkit') ?? 'Connection'}: ${q.get('result')}`);
    void load();
  }, [load]);

  const connect = async (toolkit: string) => {
    setError('');
    try {
      const r = await api<{ redirectUrl: string }>('/api/connections', { method: 'POST', body: { toolkit } });
      window.location.href = r.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start connection');
    }
  };

  return (
    <>
      <h1>Connections</h1>
      {banner && <div className="notice">{banner}</div>}
      {error && <div className="error">{error}</div>}
      <div className="card">
        {TOOLKITS.map(([slug, label, desc]) => {
          const active = items.find((c) => c.toolkit === slug && c.status === 'active');
          return (
            <div key={slug} className="row spread" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <strong>{label}</strong>
                <div className="muted small">{desc}</div>
              </div>
              {active ? <span className="badge active">connected</span> : <button onClick={() => void connect(slug)}>Connect</button>}
            </div>
          );
        })}
      </div>
      <h2>Your accounts</h2>
      {items.length === 0 && <div className="card muted">No accounts connected.</div>}
      {items.map((c) => (
        <div className="card row spread" key={c.id}>
          <div>
            <strong>{c.label ?? c.toolkit}</strong> <span className={`badge ${c.status}`}>{c.status}</span>
            <div className="muted small">Last verified {fmtTime(c.lastVerifiedAt) || 'never'}</div>
          </div>
          <div className="row">
            <button className="secondary" onClick={() => void api(`/api/connections/${c.id}/verify`, { method: 'POST', body: {} }).then(load)}>
              Re-check
            </button>
            {c.status !== 'disconnected' && (
              <button className="danger" onClick={() => void api(`/api/connections/${c.id}`, { method: 'DELETE' }).then(load)}>
                Disconnect
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
