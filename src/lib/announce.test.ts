import { describe, expect, it } from "vitest";
import { describeRun } from "./announce";

const base = { phase: "idle", activity: null, approval: null, error: null } as const;

describe("describeRun", () => {
  it("is silent when idle", () => {
    expect(describeRun(base)).toBeNull();
  });

  it("names the tool activity and approval target", () => {
    expect(describeRun({ ...base, phase: "tool", activity: "Opening browser" })).toBe(
      "Agent is working: Opening browser.",
    );
    expect(
      describeRun({ ...base, phase: "approval", approval: { tool: "shell", reason: "x", args: {} } }),
    ).toContain("shell");
  });

  it("reports completion and failure", () => {
    expect(describeRun({ ...base, phase: "done" })).toBe("Run finished.");
    expect(describeRun({ ...base, phase: "error", error: "boom" })).toBe("Run failed: boom");
  });
});
