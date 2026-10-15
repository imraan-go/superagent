import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REJECTED_TEXT,
  SKIPPED_TEXT,
  approvalSource,
  checkpointStateSchema,
  planResume,
  reconcile,
  syntheticResult,
} from "@/server/agent/checkpoint";
import type { CheckpointState } from "@/server/agent/checkpoint";
import { requiresApproval } from "@/server/agent/policy";
import { dropSupersededTerminals } from "@/lib/run-events";
import type { RunFrame } from "@/lib/run-events";

const call = (id: string, name: string) => ({ id, name, args: { n: id } });

const state: CheckpointState = {
  v: 1,
  calls: [call("a", "screen_text"), call("b", "send_email"), call("c", "file_read")],
  pendingIndex: 1,
  completed: [{ type: "tool_result", toolUseId: "a", ok: true, text: "x" }],
};

describe("planResume", () => {
  it("approve: runs the approved call un-gated, then re-gates the rest in order", () => {
    const plan = planResume(state, "approve");
    expect(plan.map((p) => [p.call.id, p.action])).toEqual([
      ["b", "run"],
      ["c", "gate"],
    ]);
  });

  it("reject: rejects the pending call and skips everything after it", () => {
    const plan = planResume(state, "reject");
    expect(plan.map((p) => [p.call.id, p.action])).toEqual([
      ["b", "reject"],
      ["c", "skip"],
    ]);
  });

  it("never re-plans calls that already completed before the checkpoint", () => {
    for (const d of ["approve", "reject"] as const) {
      expect(planResume(state, d).some((p) => p.call.id === "a")).toBe(false);
    }
  });

  it("tells the model plainly that a rejected call did not run", () => {
    const r = syntheticResult(state.calls[1]!, REJECTED_TEXT);
    expect(r).toMatchObject({ type: "tool_result", toolUseId: "b", ok: false });
    expect(REJECTED_TEXT).toMatch(/not executed/i);
    expect(SKIPPED_TEXT).toMatch(/not executed/i);
  });

  it("round-trips through the stored-state schema", () => {
    expect(checkpointStateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(checkpointStateSchema.safeParse({ v: 1, calls: [] }).success).toBe(false);
  });
});

describe("reconcile", () => {
  const tracked = [
    { id: "1", lhosApprovalId: "aaaaaaaa", kind: "confirm" as const },
    { id: "2", lhosApprovalId: "bbbbbbbb", kind: "ask" as const },
    { id: "3", lhosApprovalId: "cccccccc", kind: "confirm" as const },
  ];

  it("closes only the records LHOS no longer lists, attributing the channel", () => {
    expect(reconcile(tracked, new Set(["cccccccc"]))).toEqual([
      { id: "1", decidedVia: "lhos-page" },
      { id: "2", decidedVia: "desktop" },
    ]);
  });

  it("closes nothing while everything is still pending", () => {
    expect(reconcile(tracked, new Set(["aaaaaaaa", "bbbbbbbb", "cccccccc"]))).toEqual([]);
  });
});

describe("approvalSource", () => {
  it("routes uuids to panel checkpoints and 8-hex ids to LHOS", () => {
    expect(approvalSource("0f1e2d3c")).toBe("lhos");
    expect(approvalSource("6c1f2a0e-1b2c-4d5e-8f90-123456789abc")).toBe("panel");
    expect(approvalSource("../../etc")).toBeNull();
    expect(approvalSource("")).toBeNull();
  });
});

describe("policy with arguments", () => {
  it("gates writing HTTP requests but not reads", () => {
    expect(requiresApproval("http_request", {}, { method: "POST" }).required).toBe(true);
    expect(requiresApproval("http_request", {}, { method: "delete" }).required).toBe(true);
    expect(requiresApproval("http_request", {}, { method: "GET" }).required).toBe(false);
    expect(requiresApproval("http_request", {}, {}).required).toBe(false);
  });
});

describe("resumed run replay", () => {
  const f = (seq: number, event: RunFrame["event"]): RunFrame => ({ seq, event });

  it("drops a paused terminal frame once the run has continued past it", () => {
    const frames = [
      f(1, { type: "token", text: "hi" }),
      f(2, { type: "done", status: "paused_approval" }),
      f(3, { type: "approval_decided", approvalId: "x", tool: "t", decision: "approve" }),
      f(4, { type: "done", status: "done" }),
    ];
    expect(dropSupersededTerminals(frames).map((x) => x.seq)).toEqual([1, 3, 4]);
  });

  it("keeps the final terminal frame of a still-paused run", () => {
    const frames = [f(1, { type: "done", status: "paused_approval" })];
    expect(dropSupersededTerminals(frames)).toEqual(frames);
  });
});

/**
 * The agent must never be able to approve its own checkpoint. Structurally:
 * the code the model drives (the loop and the tool path) never imports the
 * decision functions, and every route that decides is owner-session gated.
 */
describe("no self-approval", () => {
  const root = join(__dirname, "../../src");

  it("the agent loop never calls a decision function", () => {
    const loop = readFileSync(join(root, "server/agent/loop.ts"), "utf8");
    // decideCheckpoint is *defined* in loop.ts for the route; the loop body
    // itself must never invoke it, nor the LHOS/bridge decision calls.
    const calls = loop.match(/decideCheckpoint\(/g) ?? [];
    expect(calls).toHaveLength(1); // the definition only
    expect(loop).not.toMatch(/decideApproval|answerHitl|doneHitl/);
  });

  it("every route that decides or answers is wrapped in ownerRoute", () => {
    const routes = [
      "app/api/approvals/[id]/route.ts",
      "app/api/hitl/[id]/answer/route.ts",
      "app/api/hitl/[id]/done/route.ts",
    ];
    for (const r of routes) {
      const src = readFileSync(join(root, r), "utf8");
      expect(src, r).toMatch(/export const POST = ownerRoute/);
    }
  });

  it("only owner routes import the decision functions", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) {
          const src = readFileSync(p, "utf8");
          const uses = /decideCheckpoint|decideApproval|answerHitl|doneHitl/.test(src);
          const allowed =
            p.includes("/app/api/approvals/") ||
            p.includes("/app/api/hitl/") ||
            p.endsWith("server/agent/loop.ts") ||
            p.endsWith("server/lhos/client.ts") ||
            p.endsWith("server/manage/bridge.ts");
          if (uses && !allowed) offenders.push(p);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
