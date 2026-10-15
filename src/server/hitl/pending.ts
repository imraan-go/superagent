import "server-only";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { approvals, runs } from "@/server/db/schema";
import { lhos } from "@/server/lhos/client";
import { bridge } from "@/server/manage/bridge";
import { reconcile } from "@/server/agent/checkpoint";
import { logger } from "@/server/lib/logger";
import { AppError } from "@/server/lib/errors";
import type { PendingItem } from "@/lib/hitl";

/**
 * One list of everything waiting on the owner, from three sources (ADR-02):
 *
 *  1. Panel policy checkpoints — `approvals` rows with no LHOS id; a run is
 *     paused on each.
 *  2. LHOS `GET /api/approvals` — workflow `confirm` steps plus `ask`/`takeover`.
 *  3. The host bridge's `/hitl` — `ask`/`takeover` as the host sees them;
 *     merged by id in case one source is down.
 *
 * LHOS records are mirrored into `approvals` so a record that disappears
 * without the panel deciding it can be reconciled (decided on the LHOS page or
 * the desktop dialog).
 */
export interface PendingSnapshot {
  reachable: boolean;
  items: PendingItem[];
  /** Runs currently executing — the client polls faster while any exist. */
  running: number;
}

type Kind = "confirm" | "ask" | "takeover";
const KINDS = new Set<string>(["confirm", "ask", "takeover"]);

export async function pendingSnapshot(): Promise<PendingSnapshot> {
  const [lhosResult, bridgeResult] = await Promise.allSettled([
    lhos.getPendingApprovals(),
    bridge.hitlPending(),
  ]);

  const live = new Map<string, { kind: Kind; prompt: string; created: number }>();
  if (lhosResult.status === "fulfilled") {
    for (const item of lhosResult.value) {
      live.set(item.id, { kind: item.kind, prompt: item.prompt, created: item.created });
    }
  }
  if (bridgeResult.status === "fulfilled") {
    for (const item of bridgeResult.value) {
      if (live.has(item.id)) continue;
      const kind = item.kind && KINDS.has(item.kind) ? (item.kind as Kind) : "ask";
      live.set(item.id, {
        kind,
        prompt: item.prompt ?? "",
        created: item.created ?? Date.now() / 1000,
      });
    }
  }

  const lhosOk = lhosResult.status === "fulfilled";
  if (!lhosOk) {
    logger.warn("hitl", { msg: "LHOS approvals unreachable", reason: String(lhosResult.reason) });
  }

  // Mirror new LHOS records so they can be reconciled later.
  if (live.size > 0) {
    await db
      .insert(approvals)
      .values(
        [...live.entries()].map(([id, v]) => ({
          lhosApprovalId: id,
          kind: v.kind,
          prompt: v.prompt || "(no prompt)",
          createdAt: new Date(v.created * 1000),
        })),
      )
      .onConflictDoNothing({ target: approvals.lhosApprovalId });
  }

  // Reconcile only against a successful LHOS listing (it lists every kind);
  // an outage must never read as "everything was decided".
  if (lhosOk) {
    const tracked = await db
      .select({ id: approvals.id, lhosApprovalId: approvals.lhosApprovalId, kind: approvals.kind })
      .from(approvals)
      .where(and(eq(approvals.status, "pending"), isNotNull(approvals.lhosApprovalId)));

    const gone = reconcile(
      tracked.map((t) => ({ id: t.id, lhosApprovalId: t.lhosApprovalId ?? "", kind: t.kind })),
      new Set(live.keys()),
    );
    for (const via of ["lhos-page", "desktop"] as const) {
      const ids = gone.filter((g) => g.decidedVia === via).map((g) => g.id);
      if (ids.length === 0) continue;
      await db
        .update(approvals)
        .set({ status: "answered", decidedAt: new Date(), decidedVia: via })
        .where(and(inArray(approvals.id, ids), eq(approvals.status, "pending")));
    }
  }

  const panelRows = await db
    .select({
      id: approvals.id,
      prompt: approvals.prompt,
      createdAt: approvals.createdAt,
      runId: approvals.runId,
      chatId: runs.chatId,
    })
    .from(approvals)
    .innerJoin(runs, eq(runs.id, approvals.runId))
    .where(and(eq(approvals.status, "pending"), isNull(approvals.lhosApprovalId)));

  const [runningRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(runs)
    .where(inArray(runs.status, ["running", "paused_question"]));

  const items: PendingItem[] = [
    ...panelRows.map(
      (r): PendingItem => ({
        id: r.id,
        source: "panel",
        kind: "confirm",
        prompt: r.prompt,
        createdAt: r.createdAt.toISOString(),
        runId: r.runId,
        chatId: r.chatId,
      }),
    ),
    ...[...live.entries()].map(
      ([id, v]): PendingItem => ({
        id,
        source: "lhos",
        kind: v.kind,
        prompt: v.prompt,
        createdAt: new Date(v.created * 1000).toISOString(),
        runId: null,
        chatId: null,
      }),
    ),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    reachable: lhosOk || bridgeResult.status === "fulfilled",
    items,
    running: runningRow?.n ?? 0,
  };
}

/**
 * Guard for the bridge answer/done routes: the record must be a live `ask` or
 * `takeover`. A `confirm` answered through the bridge would bypass the
 * APPROVE_TOKEN approvals path, so it is refused (409).
 */
export async function assertBridgeAnswerable(id: string, expected: "ask" | "takeover"): Promise<void> {
  const [fromBridge, fromLhos] = await Promise.allSettled([bridge.hitlPending(), lhos.getPendingApprovals()]);
  const kinds = new Set<string>();
  if (fromBridge.status === "fulfilled") {
    for (const i of fromBridge.value) if (i.id === id) kinds.add(i.kind ?? "unknown");
  }
  if (fromLhos.status === "fulfilled") {
    for (const i of fromLhos.value) if (i.id === id) kinds.add(i.kind);
  }
  if (kinds.size === 0) {
    if (fromBridge.status === "rejected" && fromLhos.status === "rejected") {
      throw new AppError("lhos_unavailable", "Cannot verify that request right now.");
    }
    throw new AppError("not_found", "That request is no longer pending.");
  }
  if (kinds.has("confirm")) {
    throw new AppError("conflict", "Approvals must be decided with Approve/Reject, not answered.");
  }
  if (!kinds.has(expected)) {
    throw new AppError("conflict", `That request is not a ${expected}.`);
  }
}

/** Marks a mirrored LHOS record decided from the panel. */
export async function markDecided(
  lhosApprovalId: string,
  status: "approved" | "rejected" | "answered",
  answer: string,
): Promise<void> {
  await db
    .update(approvals)
    .set({ status, answer, decidedAt: new Date(), decidedVia: "panel" })
    .where(eq(approvals.lhosApprovalId, lhosApprovalId));
}
