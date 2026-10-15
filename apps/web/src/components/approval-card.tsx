'use client';

import { useState } from 'react';
import { api, fmtTime, type Approval } from '../lib/api';

/** Shows the EXACT stored action (tool, account, destination, full arguments) the user is approving. */
export function ApprovalCard({ a, onDone }: { a: Approval; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/approvals/${a.id}`, { method: 'POST', body: { decision, argsHash: a.argsHash, nonce: a.nonce } });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" data-testid="approval-card">
      <div className="row spread">
        <strong>{a.tool}</strong>
        <span className="badge waiting_approval">needs your approval</span>
      </div>
      <div className="small muted">
        Account: {a.account ? `${a.account.label} (${a.account.toolkit})` : 'none'} · Tool version {a.toolVersion} · Expires {fmtTime(a.expiresAt)}
      </div>
      <label>Destination</label>
      <pre>{JSON.stringify(a.destination, null, 2)}</pre>
      <label>Exact content that will be sent</label>
      <pre>{JSON.stringify(a.args, null, 2)}</pre>
      {a.attachments.length > 0 && (
        <>
          <label>Attachments</label>
          <pre>{JSON.stringify(a.attachments, null, 2)}</pre>
        </>
      )}
      <div className="small muted">Action fingerprint {a.argsHash.slice(0, 16)}… — any change requires a new approval.</div>
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={() => decide('approved')} disabled={busy}>
          Approve exactly this
        </button>
        <button className="secondary" onClick={() => decide('rejected')} disabled={busy}>
          Reject
        </button>
      </div>
    </div>
  );
}
