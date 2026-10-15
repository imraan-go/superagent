'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { api } from '../lib/api';

const LINKS = [
  ['/', 'Tasks'],
  ['/approvals', 'Approvals'],
  ['/schedules', 'Schedules'],
  ['/connections', 'Connections'],
  ['/memory', 'Memory'],
  ['/files', 'Files'],
  ['/settings', 'Settings'],
] as const;

export function Nav({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path.startsWith('/login')) return <>{children}</>;
  const signOut = async () => {
    await api('/api/auth/sign-out', { method: 'POST', body: {} }).catch(() => undefined);
    window.location.href = '/login';
  };
  return (
    <div className="shell">
      <nav className="side">
        <div className="brand">Superagent</div>
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className={(href === '/' ? path === '/' || path.startsWith('/tasks') : path.startsWith(href)) ? 'active' : ''}>
            {label}
          </Link>
        ))}
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={signOut}>
          Sign out
        </button>
      </nav>
      <main>{children}</main>
    </div>
  );
}
