import { describe, expect, it } from "vitest";
import { decideWithRecheck } from "@/server/lhos/decide";

const timeout = () => Promise.reject(new Error("LHOS request timed out after 45000ms"));

describe("decideWithRecheck", () => {
  it("returns the normal result", async () => {
    const r = await decideWithRecheck("abcd1234", {
      post: async () => ({ ok: true, answer: "x" }),
      listPendingIds: async () => [],
    });
    expect(r).toEqual({ ok: true, answer: "x" });
  });
  it("treats a timeout as success when the record is gone", async () => {
    const r = await decideWithRecheck("abcd1234", { post: timeout, listPendingIds: async () => ["ffffffff"] });
    expect(r.ok).toBe(true);
  });
  it("rethrows the timeout when still pending", async () => {
    await expect(
      decideWithRecheck("abcd1234", { post: timeout, listPendingIds: async () => ["abcd1234"] }),
    ).rejects.toThrow(/timed out/);
  });
  it("rethrows when pending state cannot be read", async () => {
    await expect(
      decideWithRecheck("abcd1234", { post: timeout, listPendingIds: () => Promise.reject(new Error("down")) }),
    ).rejects.toThrow(/timed out/);
  });
  it("does not re-check on non-timeout errors", async () => {
    await expect(
      decideWithRecheck("abcd1234", {
        post: () => Promise.reject(new Error("boom")),
        listPendingIds: async () => [],
      }),
    ).rejects.toThrow("boom");
  });
});
