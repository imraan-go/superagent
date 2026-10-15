'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Usage {
  committedUsd: string;
  since: string;
  byKind: Array<{ kind: string; costStatus: string; usd: string; count: number }>;
  limits: { perRunUsd: string | null; monthlyUsd: string | null };
  note: string;
}
interface Setup {
  capabilities: Record<string, { configured: boolean; missing: string[] }>;
  temporalMode: string;
}
interface Settings {
  retention: { taskDays: number; operationalLogDays: number; approvalExpiryHours: number };
}

export default function SettingsPage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [perRun, setPerRun] = useState('');
  const [monthly, setMonthly] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [u, s, st] = await Promise.all([api<Usage>('/api/usage'), api<Setup>('/api/setup/status'), api<Settings>('/api/settings')]);
    setUsage(u);
    setSetup(s);
    setSettings(st);
    setPerRun(u.limits.perRunUsd ?? '');
    setMonthly(u.limits.monthlyUsd ?? '');
  }, []);
  useEffect(() => void load(), [load]);

  const saveBudget = async () => {
    try {
      const r = await api<{ effective: { perRunUsd: string; monthlyUsd: string } }>('/api/settings/budget', { method: 'PUT', body: { maxCostPerRunUsd: perRun, monthlyLimitUsd: monthly } });
      setMsg(`Effective limits: $${r.effective.perRunUsd} per run, $${r.effective.monthlyUsd} per month (installation caps can't be raised here).`);
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not save');
    }
  };

  const deleteAll = async () => {
    if (!window.confirm('Permanently delete all your tasks, files, memories, schedules and connections? This cannot be undone.')) return;
    try {
      const r = await api<{ residual: string[] }>('/api/me/data', { method: 'DELETE' });
      setMsg(`Deleted. Residual copies outside this app: ${r.residual.join(' ')}`);
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not delete');
    }
  };

  return (
    <>
      <h1>Settings</h1>
      {msg && <div className="notice">{msg}</div>}
      <h2>Usage this month</h2>
      <div className="card">
        {usage && (
          <>
            <div>
              Committed (incl. reservations): <strong>${usage.committedUsd}</strong> since {new Date(usage.since).toLocaleDateString()}
            </div>
            <table>
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Cost status</th>
                  <th>Count</th>
                  <th>USD</th>
                </tr>
              </thead>
              <tbody>
                {usage.byKind.map((k) => (
                  <tr key={`${k.kind}-${k.costStatus}`}>
                    <td>{k.kind}</td>
                    <td>
                      <span className={`badge ${k.costStatus === 'measured' ? 'ok' : k.costStatus === 'estimated' ? 'warn' : 'bad'}`}>{k.costStatus}</span>
                    </td>
                    <td>{k.count}</td>
                    <td>{k.costStatus === 'unknown' ? '—' : `$${k.usd}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="muted small">{usage.note}</div>
          </>
        )}
      </div>
      <h2>Budget</h2>
      <div className="card">
        <div className="row">
          <div style={{ flex: 1 }}>
            <label htmlFor="perrun">Max per run (USD)</label>
            <input id="perrun" value={perRun} onChange={(e) => setPerRun(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="monthly">Monthly limit (USD)</label>
            <input id="monthly" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <button onClick={() => void saveBudget()}>Save limits</button>
        </div>
      </div>
      <h2>Setup</h2>
      <div className="card">
        {setup &&
          Object.entries(setup.capabilities).map(([k, v]) => (
            <div key={k} className="row spread" style={{ padding: '4px 0' }}>
              <span>{k}</span>
              <span className={`badge ${v.configured ? 'ok' : 'warn'}`}>{v.configured ? 'configured' : `missing ${v.missing.join(', ')}`}</span>
            </div>
          ))}
        <div className="muted small">Temporal mode: {setup?.temporalMode}</div>
      </div>
      <h2>Data</h2>
      <div className="card">
        {settings && (
          <div className="muted small">
            Task history kept {settings.retention.taskDays} days · operational logs {settings.retention.operationalLogDays} days · approvals expire after {settings.retention.approvalExpiryHours} h.
          </div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <a href="/api/export">
            <button className="secondary">Export my data (JSON)</button>
          </a>
          <button className="danger" onClick={() => void deleteAll()}>
            Delete all my data
          </button>
        </div>
      </div>
    </>
  );
}
