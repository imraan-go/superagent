"use client";

import { useQuery } from "@tanstack/react-query";
import type { DotStatus } from "@/components/ui/dot";

export interface WorkspaceView {
  id: string;
  kind: "code" | "browser";
  scope: "user" | "task";
  taskId: string | null;
  state: "creating" | "running" | "paused" | "killed" | "lost" | "failed";
  sandboxId: string | null;
  templateId: string;
  lastActiveAt: string | null;
  activeMs: number;
  lastError: string | null;
  createdAt: string;
}

export interface SystemStatus {
  capabilities: Record<string, { configured: boolean; missing: string[] }>;
  /** `stalled`: the outbox is not draining, i.e. the Temporal worker is not running. */
  worker: "ok" | "stalled";
  running: number;
  workspaces: WorkspaceView[];
  connectedApps: number;
  pending: { questions: number; approvals: number };
}

export type ComputerState = "checking" | "ready" | "working" | "setup" | "offline";

export const STATUS_KEY = ["system", "status"] as const;

export async function fetchStatus(): Promise<SystemStatus> {
  const res = await fetch("/api/capabilities", { cache: "no-store" });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()) as SystemStatus;
}

/**
 * One shared status query (same key everywhere: the topbar dot, the rail header, the sidebar
 * card and the landing all read one request). States:
 *   offline — the worker is not draining the outbox, so runs will not start;
 *   setup   — no model gateway configured;
 *   working — a run is executing; ready — idle and able to run.
 */
export function useCapabilities() {
  const query = useQuery<SystemStatus>({ queryKey: STATUS_KEY, queryFn: fetchStatus, refetchInterval: 15_000 });
  const c = query.data;
  const state: ComputerState = query.isError
    ? "offline"
    : !c
      ? "checking"
      : c.worker === "stalled"
        ? "offline"
        : !c.capabilities.gateway?.configured
          ? "setup"
          : c.running > 0
            ? "working"
            : "ready";
  const dot: DotStatus = state === "working" ? "live" : state === "ready" ? "ok" : state === "setup" ? "warn" : state === "offline" ? "error" : "idle";
  const workspace = c?.workspaces.find((w) => w.kind === "code") ?? null;
  return { capabilities: c, state, dot, workspace, isError: query.isError };
}

export const STATE_LABEL: Record<ComputerState, string> = {
  checking: "checking",
  ready: "ready",
  working: "working",
  setup: "setup needed",
  offline: "worker offline",
};
