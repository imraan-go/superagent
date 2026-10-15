'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApprovalCard } from '../../components/approval-card';
import { api, type Approval } from '../../lib/api';

export default function ApprovalsPage() {
  const [items, setItems] = useState<Approval[]>([]);
  const load = useCallback(async () => setItems((await api<{ approvals: Approval[] }>('/api/approvals')).approvals), []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);
  return (
    <>
      <h1>Approvals</h1>
      {items.length === 0 && <div className="card muted">Nothing is waiting for you.</div>}
      {items.map((a) => (
        <div key={a.id}>
          <div className="small muted">
            From <Link href={`/tasks/${a.taskId}`}>task</Link>
          </div>
          <ApprovalCard a={a} onDone={load} />
        </div>
      ))}
    </>
  );
}
