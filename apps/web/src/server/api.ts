import 'server-only';
import { cookies } from 'next/headers';
import type { ThemePreference } from '@/lib/theme';

/**
 * Server-component access to the API. The browser only talks to the web origin (next.config
 * rewrites /api/* to the API on loopback); server components call the API directly and forward
 * the caller's cookies, so ownership is still enforced by the API's session middleware.
 */
const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';

async function serverGet<T>(path: string): Promise<T | null> {
  const jar = await cookies();
  const res = await fetch(`${API}${path}`, {
    headers: { cookie: jar.toString() },
    cache: 'no-store',
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json()) as T;
}

export interface Owner {
  userId: string;
  email: string;
  name: string;
}

export async function getOwner(): Promise<Owner | null> {
  const r = await serverGet<{ user: { id: string; email: string; name: string } }>('/api/me');
  return r ? { userId: r.user.id, email: r.user.email, name: r.user.name } : null;
}

export async function getChatTitle(id: string): Promise<string | null> {
  const r = await serverGet<{ chat: { title: string } }>(`/api/chats/${encodeURIComponent(id)}`);
  return r?.chat.title ?? null;
}

export async function getAppearanceTheme(): Promise<ThemePreference | null> {
  const r = await serverGet<{ theme?: string }>('/api/settings/appearance');
  return r?.theme === 'dark' || r?.theme === 'light' || r?.theme === 'system' ? r.theme : null;
}
