import { describe, expect, it } from "vitest";
import { budgetStatus } from "@/lib/usage-budget";

describe("budgetStatus", () => {
  it("is null when no budget", () => expect(budgetStatus(5, 0, 80)).toBeNull());
  it("ok below threshold", () => expect(budgetStatus(7.9, 10, 80)?.state).toBe("ok"));
  it("warn at threshold", () => expect(budgetStatus(8, 10, 80)?.state).toBe("warn"));
  it("warn at exactly budget", () => expect(budgetStatus(10, 10, 80)?.state).toBe("warn"));
  it("over when exceeded", () => expect(budgetStatus(10.01, 10, 80)?.state).toBe("over"));
});
