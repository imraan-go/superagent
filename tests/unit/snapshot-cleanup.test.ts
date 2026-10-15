import { describe, expect, it } from "vitest";
import {
  badgeFor,
  canPreview,
  canPurge,
  canQuarantine,
  canRestore,
  clampKeep,
  evaluateVerify,
  planSchema,
  purgeResultSchema,
  QUARANTINE_NAME_RE,
  quarantineResultSchema,
  quarantinesSchema,
  restoreResultSchema,
} from "@/lib/manage/snapshot-cleanup";
import type { CleanupPlan } from "@/lib/manage/snapshot-cleanup";

const plan: CleanupPlan = planSchema.parse({
  storage: "/x",
  keepDesktop: 3,
  roots: ["root-a", "root-b"],
  missingRoots: [],
  keepCount: 5,
  keepBytes: 100,
  delete: [{ id: "old-1", bytes: 10, status: "success" }],
  deleteBytes: 10,
});
const empty: CleanupPlan = { ...plan, delete: [], deleteBytes: 0 };

describe("bridge response parsing", () => {
  it("parses a plan, defaults missingRoots, keeps unknown fields", () => {
    const p = planSchema.parse({ roots: [], keepCount: 0, keepBytes: 0, delete: [], deleteBytes: 0, extra: 1 });
    expect(p.missingRoots).toEqual([]);
    expect((p as Record<string, unknown>).extra).toBe(1);
  });
  it("rejects a malformed plan", () => {
    expect(planSchema.safeParse({ roots: [], delete: [{ id: "a" }] }).success).toBe(false);
  });
  it("parses quarantine, list, restore and purge shapes", () => {
    expect(quarantineResultSchema.parse({ quarantine: null, moved: 0, bytes: 0 }).quarantine).toBeNull();
    expect(quarantinesSchema.parse({ quarantines: [{ name: "snapshot-quarantine-20261015-010101", builds: 2, bytes: 5, created: 1.5 }] }).quarantines).toHaveLength(1);
    expect(restoreResultSchema.parse({ restored: 2 }).restored).toBe(2);
    expect(purgeResultSchema.parse({ purged: "n", freedBytes: 9 }).freedBytes).toBe(9);
  });
  it("only accepts quarantine directory names", () => {
    expect(QUARANTINE_NAME_RE.test("snapshot-quarantine-20261015-010101")).toBe(true);
    expect(QUARANTINE_NAME_RE.test("../etc")).toBe(false);
    expect(QUARANTINE_NAME_RE.test("snapshot-quarantine-1/../x")).toBe(false);
  });
});

describe("badges", () => {
  it("derives badges from the plan only", () => {
    expect(badgeFor("root-a", 9999, plan)).toBe("kept-root");
    expect(badgeFor("old-1", 9999, plan)).toBe("deletable");
    expect(badgeFor("mid", 9999, plan)).toBe("kept-ancestor");
    expect(badgeFor("fresh", 30, plan)).toBe("in-flight");
    expect(badgeFor("x", 1, undefined)).toBeNull();
  });
});

describe("button-enable state machine", () => {
  it("clamps keep to 2..20", () => {
    expect(clampKeep(1)).toBe(2);
    expect(clampKeep(99)).toBe(20);
    expect(clampKeep(Number.NaN)).toBe(3);
  });
  it("preview is blocked while busy", () => {
    expect(canPreview({ keep: 3, busy: false })).toBe(true);
    expect(canPreview({ keep: 3, busy: true })).toBe(false);
  });
  it("quarantine needs a fresh, non-empty plan", () => {
    expect(canQuarantine({ keep: 3, planKeep: null, plan: undefined, busy: false })).toBe(false);
    expect(canQuarantine({ keep: 3, planKeep: 3, plan, busy: false })).toBe(true);
    expect(canQuarantine({ keep: 4, planKeep: 3, plan, busy: false })).toBe(false);
    expect(canQuarantine({ keep: 3, planKeep: 3, plan: empty, busy: false })).toBe(false);
    expect(canQuarantine({ keep: 3, planKeep: 3, plan, busy: true })).toBe(false);
  });
  it("purge needs verify-or-override AND the typed phrase", () => {
    const base = { verified: false, override: false, typed: "DELETE", busy: false };
    expect(canPurge(base)).toBe(false);
    expect(canPurge({ ...base, verified: true })).toBe(true);
    expect(canPurge({ ...base, override: true })).toBe(true);
    expect(canPurge({ ...base, verified: true, typed: "delete" })).toBe(false);
    expect(canPurge({ ...base, verified: true, busy: true })).toBe(false);
  });
  it("restore is available unless busy", () => {
    expect(canRestore({ busy: false })).toBe(true);
    expect(canRestore({ busy: true })).toBe(false);
  });
});

describe("desktop verification", () => {
  const s = { sinceBefore: "t0", since: "t0", active: "active", desktopService: "active", elapsedMs: 3000 };
  it("ignores the old process right after the no-block restart", () => {
    expect(evaluateVerify(s).state).toBe("pending");
  });
  it("passes once active with a new start time and the desktop agrees", () => {
    expect(evaluateVerify({ ...s, since: "t1" }).state).toBe("ok");
    expect(evaluateVerify({ ...s, since: "t1", desktopService: "activating" }).state).toBe("pending");
  });
  it("accepts an unchanged start time after the grace period", () => {
    expect(evaluateVerify({ ...s, elapsedMs: 20_000 }).state).toBe("ok");
  });
  it("fails after the timeout", () => {
    const r = evaluateVerify({ ...s, since: "t1", active: "failed", desktopService: "failed", elapsedMs: 130_000 });
    expect(r.state).toBe("failed");
  });
});
