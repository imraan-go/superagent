import { describe, expect, it } from "vitest";
import {
  backoffMs,
  classifyFailure,
  isRetryable,
} from "@/server/lhos/retryable";

/**
 * The classifier decides whether a run shows "computer waking up" and retries,
 * or fails outright. Getting it wrong either aborts healthy runs or hides real
 * errors behind a retry loop.
 */
describe("classifyFailure", () => {
  it("recognises desktop-recreating messages as waking", () => {
    const waking = [
      "desk is not ready yet",
      "Sandbox is recreating, try again",
      "restoring the desktop from snapshot",
      "desktop is not up",
      "failed to connect to sandbox injo6euds4",
      "E2B returned 503 unavailable",
    ];
    for (const message of waking) {
      expect(classifyFailure({ message }), message).toBe("waking");
    }
  });

  it("treats 5xx and 429 as transiently unavailable", () => {
    expect(classifyFailure({ status: 500, message: "boom" })).toBe("unavailable");
    expect(classifyFailure({ status: 502, message: "bad gateway" })).toBe("unavailable");
    expect(classifyFailure({ status: 429, message: "slow down" })).toBe("unavailable");
  });

  it("treats 4xx as fatal — retrying a bad request never helps", () => {
    expect(classifyFailure({ status: 400, message: "validation error" })).toBe("fatal");
    expect(classifyFailure({ status: 404, message: "Unknown tool" })).toBe("fatal");
  });

  it("recognises transport failures without a status", () => {
    expect(classifyFailure({ message: "ECONNRESET" })).toBe("unavailable");
    expect(classifyFailure({ message: "fetch failed" })).toBe("unavailable");
    expect(classifyFailure({ message: "socket hang up" })).toBe("unavailable");
  });

  it("defaults to fatal for an unrecognised message", () => {
    expect(classifyFailure({ message: "the tool said no" })).toBe("fatal");
    expect(classifyFailure({})).toBe("fatal");
  });

  it("prefers a waking message over the HTTP status", () => {
    // A 400 whose body says the sandbox is restoring is still retryable.
    expect(
      classifyFailure({ status: 400, message: "sandbox is restoring" }),
    ).toBe("waking");
  });
});

describe("isRetryable", () => {
  it("retries waking and unavailable, never fatal", () => {
    expect(isRetryable("waking")).toBe(true);
    expect(isRetryable("unavailable")).toBe(true);
    expect(isRetryable("fatal")).toBe(false);
  });
});

describe("backoffMs", () => {
  it("waits 30s for a waking desktop", () => {
    expect(backoffMs("waking", 0)).toBe(30_000);
    expect(backoffMs("waking", 3)).toBe(30_000);
  });

  it("backs off exponentially for transport errors, capped at 8s", () => {
    expect(backoffMs("unavailable", 0)).toBe(1_000);
    expect(backoffMs("unavailable", 1)).toBe(2_000);
    expect(backoffMs("unavailable", 2)).toBe(4_000);
    expect(backoffMs("unavailable", 9)).toBe(8_000);
  });

  it("does not wait before a fatal failure", () => {
    expect(backoffMs("fatal", 0)).toBe(0);
  });
});
