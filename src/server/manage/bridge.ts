import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/db/schema";
import { redactSecrets, redactValue } from "@/server/lib/redact";
import { env } from "@/server/env";
import { AppError } from "@/server/lib/errors";

/**
 * Typed client for the host bridge (`/root/e2b-agent-vm/bin/host_bridge.py`).
 *
 * The bridge is the ONLY way the panel touches the host: a loopback-only,
 * token-gated, allowlisted HTTP API. There is no free-form shell anywhere —
 * add a new capability on the bridge side first, then a function here.
 *
 * Every mutating call is written to `audit` (docs/MANAGE_TAB.md §Host bridge).
 */

export const MANAGED_UNITS = [
  "e2b-infra",
  "e2b-api",
  "e2b-orchestrator",
  "e2b-client-proxy",
  "e2b-firewall",
  "e2b-desktop-vnc",
  "e2b-mcp",
  "e2b-scheduler",
  "caddy",
] as const;
export type ManagedUnit = (typeof MANAGED_UNITS)[number];

export const serviceSchema = z.object({
  unit: z.string(),
  active: z.string().nullable(),
  sub: z.string().nullable(),
  since: z.string().nullable(),
  memoryBytes: z.number().nullable(),
  pid: z.number().nullable(),
  enabled: z.string().nullable().optional(),
});
export type ServiceStatus = z.infer<typeof serviceSchema>;

export const statsSchema = z.object({
  ts: z.number(),
  cpuPercent: z.number().nullable(),
  cpuCount: z.number().nullable(),
  load: z.array(z.number()),
  memTotal: z.number(),
  memAvailable: z.number(),
  swapTotal: z.number(),
  swapFree: z.number(),
  diskTotal: z.number(),
  diskFree: z.number(),
  diskUsedPercent: z.number(),
  uptimeSeconds: z.number(),
});
export type HostStats = z.infer<typeof statsSchema>;

export const desktopSchema = z
  .object({
    sandbox_id: z.string().optional(),
    url: z.string().optional(),
    mode: z.string().optional(),
    service: z.string().optional(),
  })
  .passthrough();
export type DesktopInfo = z.infer<typeof desktopSchema>;

export const configRowSchema = z.object({
  key: z.string(),
  secret: z.boolean(),
  value: z.string().nullable(),
  length: z.number(),
});
export type ConfigRow = z.infer<typeof configRowSchema>;

export const jobSchema = z.object({
  id: z.string(),
  action: z.string(),
  started: z.number(),
  ended: z.number().nullable(),
  ok: z.boolean().nullable(),
  output: z.string(),
});
export type BridgeJob = z.infer<typeof jobSchema>;

export const hitlPendingSchema = z.object({
  id: z.string(),
  kind: z.string().nullable(),
  prompt: z.string().nullable(),
  created: z.number().nullable(),
});

async function call<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.BRIDGE_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        authorization: `Bearer ${env.BRIDGE_TOKEN}`,
        ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init?.timeoutMs ?? 20_000),
      cache: "no-store",
    });
  } catch {
    throw new AppError("bridge_unavailable", "The host bridge is not reachable.");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // fall through to the status checks
  }
  if (!res.ok && res.status !== 202) {
    const msg = (json as { error?: string; output?: string } | null)?.error ?? `Bridge error ${res.status}`;
    if (res.status === 404) throw new AppError("not_found", msg);
    if (res.status === 400 || res.status === 409) throw new AppError("bad_request", msg);
    throw new AppError("bridge_unavailable", msg);
  }
  return schema.parse(json);
}

async function audited<T>(action: string, detail: unknown, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    await db.insert(audit).values({ action, detail: redactValue(detail) as object, ok: true, result: summarise(result) });
    return result;
  } catch (err) {
    await db
      .insert(audit)
      .values({ action, detail: redactValue(detail) as object, ok: false, result: redactSecrets(err instanceof Error ? err.message : String(err)) })
      .catch(() => {});
    throw err;
  }
}

function summarise(v: unknown): string {
  const s = redactSecrets(typeof v === "string" ? v : JSON.stringify(v));
  return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
}

const okOutput = z.object({ ok: z.boolean(), output: z.string().optional() }).passthrough();

export const bridge = {
  health: () => call("/health", z.object({ ok: z.boolean() }), { timeoutMs: 3_000 }),

  services: async () => (await call("/services", z.object({ services: z.array(serviceSchema) }))).services,
  stats: () => call("/stats", statsSchema),
  desktop: () => call("/desktop", desktopSchema),
  config: async () => (await call("/config", z.object({ config: z.array(configRowSchema) }))).config,
  reports: async () =>
    (await call("/reports", z.object({ reports: z.array(z.object({ date: z.string(), bytes: z.number() })) })))
      .reports,
  hitlPending: async () => (await call("/hitl", z.object({ pending: z.array(hitlPendingSchema) }))).pending,
  logs: async (unit: ManagedUnit, n = 200, since?: string) => {
    const q = new URLSearchParams({ n: String(n) });
    if (since) q.set("since", since);
    return (await call(`/logs/${unit}?${q}`, z.object({ unit: z.string(), lines: z.array(z.string()) }))).lines;
  },
  jobs: async () => (await call("/jobs", z.object({ jobs: z.array(jobSchema) }))).jobs,
  job: (id: string) => call(`/jobs/${encodeURIComponent(id)}`, jobSchema),

  /** Mutations — audited. */
  restartService: (unit: ManagedUnit) =>
    audited("service.restart", { unit }, () =>
      call(`/services/${unit}/restart`, okOutput.extend({ unit: z.string(), action: z.string() }), {
        method: "POST",
        body: {},
      }),
    ),
  desktopAction: (verb: "sleep" | "wake" | "new") =>
    audited(`desktop.${verb}`, {}, () => call(`/desktop/${verb}`, jobSchema, { method: "POST", body: {} })),
  answerHitl: (id: string, text: string) =>
    audited("hitl.answer", { id }, () =>
      call(`/hitl/${encodeURIComponent(id)}/answer`, okOutput, { method: "POST", body: { text } }),
    ),
  doneHitl: (id: string) =>
    audited("hitl.done", { id }, () =>
      call(`/hitl/${encodeURIComponent(id)}/done`, okOutput, { method: "POST", body: {} }),
    ),
  rotateAuth: () => audited("auth.rotate", {}, () => call("/rotate-auth", jobSchema, { method: "POST", body: {} })),
};
