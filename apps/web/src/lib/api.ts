'use client';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : `HTTP ${status}`);
  }
}

export async function api<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
    return new Promise<T>(() => undefined);
  }
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

export function fmtTime(s: string | null | undefined) {
  if (!s) return '';
  return new Date(s).toLocaleString();
}

export interface Task {
  id: string;
  title: string;
  prompt: string;
  status: string;
  origin: string;
  readOnly: boolean;
  allowedDomains: string[];
  resultSummary: string | null;
  error: string | null;
  createdAt: string;
  workflowId: string;
}

export interface TaskEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface Artifact {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  taskId: string | null;
  source: Record<string, unknown>;
  createdAt: string;
}

export interface Approval {
  id: string;
  taskId: string;
  tool: string;
  toolVersion: string;
  account: { id: string; toolkit: string; label: string } | null;
  destination: Record<string, unknown>;
  args: Record<string, unknown>;
  attachments: unknown[];
  argsHash: string;
  nonce: string;
  status: string;
  expiresAt: string;
}
