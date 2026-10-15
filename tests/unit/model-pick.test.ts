import { describe, expect, it } from "vitest";
import { pickModel } from "@/lib/model-pick";

const ready = ["mock/echo", "anthropic/sonnet"];

describe("pickModel", () => {
  it("keeps the chat's model over the global default", () => {
    expect(pickModel({ chosen: null, chatModel: "mock/echo", defaultModel: "anthropic/sonnet", ready })).toBe(
      "mock/echo",
    );
  });

  it("an explicit choice wins", () => {
    expect(
      pickModel({ chosen: "anthropic/sonnet", chatModel: "mock/echo", defaultModel: "mock/echo", ready }),
    ).toBe("anthropic/sonnet");
  });

  it("falls back to the default when the chat's model is not ready", () => {
    expect(pickModel({ chosen: null, chatModel: "openai/gone", defaultModel: "anthropic/sonnet", ready })).toBe(
      "anthropic/sonnet",
    );
    expect(pickModel({ chosen: null, chatModel: null, defaultModel: null, ready })).toBe("");
  });
});
