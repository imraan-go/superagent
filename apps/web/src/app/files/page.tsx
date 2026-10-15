'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtTime, type Artifact } from '../../lib/api';

export default function FilesPage() {
  const [items, setItems] = useState<Artifact[]>([]);
  const load = useCallback(async () => setItems((await api<{ artifacts: Artifact[] }>('/api/artifacts')).artifacts), []);
  useEffect(() => void load(), [load]);
  return (
    <>
      <h1>Files</h1>
      <div className="card">
        {items.length === 0 ? (
          <div className="muted">No files yet. Files the assistant exports, screenshots and downloads appear here.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Source</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <a href={`/api/artifacts/${a.id}/download`}>{a.name}</a>
                  </td>
                  <td className="small">{a.contentType}</td>
                  <td className="small">{a.sizeBytes}</td>
                  <td className="small">{typeof a.source.url === 'string' ? a.source.url : a.taskId ? <Link href={`/tasks/${a.taskId}`}>task</Link> : ''}</td>
                  <td className="small muted">{fmtTime(a.createdAt)}</td>
                  <td>
                    <button className="danger" onClick={() => void api(`/api/artifacts/${a.id}`, { method: 'DELETE' }).then(load)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
