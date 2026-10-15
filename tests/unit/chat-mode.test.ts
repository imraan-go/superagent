import { describe, expect, it } from "vitest";
import {
  CHAT_MODES,
  DEFAULT_CHAT_PREFS,
  chatModeSchema,
  maxTokensFor,
  modeAddendum,
  parseChatMode,
  parseChatPrefs,
  supportsThinking,
  traceStaysOpen,
  wantsThinking,
} from "@/lib/chat-mode";

describe("chat modes", () => {
  it("validates the four modes and rejects anything else", () => {
    expect(CHAT_MODES).toEqual(["default", "thinking", "verbose", "debug"]);
    expect(chatModeSchema.safeParse("debug").success).toBe(true);
    expect(chatModeSchema.safeParse("godmode").success).toBe(false);
    expect(parseChatMode("godmode")).toBe("default");
  });

  it("threads mode into prompt, thinking, tokens and trace behaviour", () => {
    expect(modeAddendum("default")).toMatch(/concise/i);
    expect(modeAddendum("verbose")).toMatch(/numbered plan/);
    expect(modeAddendum("debug")).toBe(modeAddendum("verbose"));
    expect(wantsThinking("thinking")).toBe(true);
    expect(wantsThinking("debug")).toBe(false);
    expect(maxTokensFor("thinking")).toBeGreaterThan(maxTokensFor("default"));
    expect(traceStaysOpen("default")).toBe(false);
    expect(traceStaysOpen("verbose")).toBe(true);
    expect(traceStaysOpen("debug")).toBe(true);
    expect(supportsThinking("anthropic")).toBe(true);
    expect(supportsThinking("openai")).toBe(false);
  });

  it("parses stored prefs tolerantly (legacy string, corrupt fields)", () => {
    expect(parseChatPrefs(null)).toEqual(DEFAULT_CHAT_PREFS);
    expect(parseChatPrefs("verbose")).toEqual({ ...DEFAULT_CHAT_PREFS, mode: "verbose" });
    expect(parseChatPrefs({ mode: "nope", capsAuto: false, caps: ["rdp"] })).toEqual({
      mode: "default",
      capsAuto: false,
      caps: ["rdp"],
    });
    expect(DEFAULT_CHAT_PREFS.capsAuto).toBe(true);
  });
});
