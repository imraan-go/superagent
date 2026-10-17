import { readApiError } from '@/lib/api-error';

/** Typed client for the Workspaces view (same-origin JSON). */
export class ManageApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ManageApiError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, cache: 'no-store' });
  } catch {
    throw new ManageApiError('network', 'Could not reach the server.', 0);
  }
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = readApiError(body, res.status);
    throw new ManageApiError(e.code, e.message, res.status);
  }
  return body as T;
}

export const apiGet = <T>(path: string) => call<T>(path);
export const apiPost = <T = { ok: true }>(path: string, body: unknown = {}) =>
  call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
