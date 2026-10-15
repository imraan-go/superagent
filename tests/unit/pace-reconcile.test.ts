import { describe, expect, it } from "vitest";
import { parseStored, reconcilePace } from "@/lib/settings";

describe("reconcilePace", () => {
  const def = parseStored("agent", undefined);
  it("reflects LHOS when no pace was saved", () => {
    expect(reconcilePace(def, undefined, "fast").pace).toBe("fast");
    expect(reconcilePace(parseStored("agent", { maxSteps: 5 }), { maxSteps: 5 }, "fast").pace).toBe("fast");
  });
  it("keeps a saved pace", () => {
    const raw = { pace: "careful" };
    expect(reconcilePace(parseStored("agent", raw), raw, "fast").pace).toBe("careful");
  });
  it("ignores unknown or missing LHOS modes", () => {
    expect(reconcilePace(def, undefined, "turbo").pace).toBe("careful");
    expect(reconcilePace(def, undefined, null).pace).toBe("careful");
  });
});
