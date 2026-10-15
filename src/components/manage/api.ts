import { z } from "zod";

/** Typed client for the /api/manage routes. */

export class ManageApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ManageApiError";
    this.code = code;
    this.status = status;
  }
  /** The host bridge (or LHOS) could not be reached — show the "unreachable" state. */
  get unreachable(): boolean {
    return this.code === "bridge_unavailable" || this.code === "lhos_unavailable" || this.code === "computer_waking";
  }
}

const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

async function request<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ManageApiError("network", "The panel server is not reachable.", 0);
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body
  }
  if (!res.ok) {
    const e = errorBody.safeParse(parsed);
    throw new ManageApiError(
      e.success ? e.data.error.code : "internal",
      e.success ? e.data.error.message : `Request failed (${res.status}).`,
      res.status,
    );
  }
  return parsed as T;
}

export const apiGet = <T>(path: string) => request<T>(path);
export const apiPost = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body });

export async function apiText(path: string): Promise<string> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    const e = errorBody.safeParse(await res.json().catch(() => null));
    throw new ManageApiError(e.success ? e.data.error.code : "internal", e.success ? e.data.error.message : "Request failed.", res.status);
  }
  return res.text();
}

/* ------------------------------------------------------------- shapes -- */

export interface ServiceRow {
  unit: string;
  active: string | null;
  sub: string | null;
  since: string | null;
  memoryBytes: number | null;
  pid: number | null;
  enabled?: string | null;
}

export interface Stats {
  ts: number;
  cpuPercent: number | null;
  cpuCount: number | null;
  load: number[];
  memTotal: number;
  memAvailable: number;
  swapTotal: number;
  swapFree: number;
  diskTotal: number;
  diskFree: number;
  diskUsedPercent: number;
  uptimeSeconds: number;
}

export interface Desktop {
  sandbox_id?: string;
  url?: string;
  mode?: string;
  service?: string;
}

export interface Job {
  id: string;
  action: string;
  started: number;
  ended: number | null;
  ok: boolean | null;
  output: string;
}

export interface ConfigRow {
  key: string;
  secret: boolean;
  value: string | null;
  length: number;
}

export interface AuditEntry {
  id: string;
  who: string;
  action: string;
  detail: unknown;
  ok: boolean;
  result: string | null;
  ts: string;
}

export interface HitlItem {
  id: string;
  kind: string | null;
  prompt: string | null;
  created: number | null;
}
