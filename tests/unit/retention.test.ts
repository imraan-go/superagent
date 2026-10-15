import { describe, expect, it } from "vitest";
import { retentionCutoff } from "@/lib/retention";

describe("retentionCutoff", () => {
  const now = new Date("2026-10-15T00:00:00Z");
  it("0 means forever", () => expect(retentionCutoff(0, now)).toBeNull());
  it("computes N days back", () =>
    expect(retentionCutoff(30, now)?.toISOString()).toBe("2026-09-15T00:00:00.000Z"));
});
