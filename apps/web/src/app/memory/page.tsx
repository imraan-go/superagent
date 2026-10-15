'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, fmtTime } from '../../lib/api';

interface Memory {
  id: string;
  content: string;
  provenance: Record<string, unknown>;
  updatedAt: string;
}

export default function MemoryPage() {
  const [items, setItems] = useState<Memory[]>([]);
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const load = useCallback(async () => setItems((await api<{ memories: Memory[] }>('/api/memories')).memories), []);
  useEffect(() => void load(), [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    await api('/api/memories', { method: 'POST', body: { content } });
    setContent('');
    await load();
  };

  return (
    <>
      <h1>Memory</h1>
      <p className="muted">Durable notes the assistant may use. You can edit or permanently delete any of them.</p>
      <form className="card row" onSubmit={add}>
        <input aria-label="New memory" value={content} onChange={(e) => setContent(e.target.value)} placeholder="e.g. I prefer meetings after 10am" style={{ flex: 1 }} required />
        <button type="submit">Add</button>
      </form>
      {items.map((m) => (
        <div className="card" key={m.id} data-testid="memory">
          {editing === m.id ? (
            <div className="row">
              <input aria-label="Edit memory" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1 }} />
              <button onClick={() => void api(`/api/memories/${m.id}`, { method: 'PATCH', body: { content: draft } }).then(() => (setEditing(null), load()))}>Save</button>
            </div>
          ) : (
            <div className="row spread">
              <div>{m.content}</div>
              <div className="row">
                <button className="secondary" onClick={() => (setEditing(m.id), setDraft(m.content))}>
                  Edit
                </button>
                <button className="danger" onClick={() => void api(`/api/memories/${m.id}`, { method: 'DELETE' }).then(load)}>
                  Delete
                </button>
              </div>
            </div>
          )}
          <div className="muted small">
            {m.provenance.source === 'agent' ? 'Saved by the assistant during a task' : 'Added by you'} · {fmtTime(m.updatedAt)}
          </div>
        </div>
      ))}
    </>
  );
}
