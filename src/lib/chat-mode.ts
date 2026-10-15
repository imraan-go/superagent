import { z } from "zod";

/**
 * Per-chat conversation modes (Default · Thinking · Verbose · Debug).
 * Pure module shared by the composer, the messages route and the agent loop.
 *
 * - default:  concise answers; trace collapses once the run settles.
 * - thinking: extended (adaptive) thinking on models that support it; the
 *             summarised reasoning is shown as a dimmed "Reasoning" block.
 * - verbose:  the agent narrates plan + steps; trace stays expanded with args.
 * - debug:    verbose + raw events, timings, per-call tokens/cost, tool list
 *             size, redacted system prompt preview and request params.
 */
export const CHAT_MODES = ["default", "thinking", "verbose", "debug"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];
export const chatModeSchema = z.enum(CHAT_MODES);
export const DEFAULT_CHAT_MODE: ChatMode = "default";

export const CHAT_MODE_META: Record<ChatMode, { label: string; hint: string }> = {
  default: { label: "Default", hint: "Concise answers, trace collapses when done" },
  thinking: { label: "Thinking", hint: "Extended reasoning on supported models" },
  verbose: { label: "Verbose", hint: "Narrates the plan and each step; trace stays open" },
  debug: { label: "Debug", hint: "Verbose plus raw events, tokens, prompt and params" },
};

export function parseChatMode(value: unknown): ChatMode {
  const parsed = chatModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_CHAT_MODE;
}

/** Narration rules appended to the system prompt (after the cached prefix). */
export function modeAddendum(mode: ChatMode): string {
  switch (mode) {
    case "default":
      return "## Response style\nBe concise. Minimal narration: act, verify, then give a short final answer.";
    case "thinking":
      return "## Response style\nThink the task through carefully before acting. Keep the visible answer concise.";
    case "verbose":
    case "debug":
      return [
        "## Response style (verbose)",
        "- Start by stating a short numbered plan.",
        "- Before each tool call, say in one sentence what you are doing and why.",
        "- After each result, say what you observed and what comes next.",
        "- End with a summary of what was done and verified.",
      ].join("\n");
  }
}

/** Whether a run in this mode requests extended thinking from the model. */
export function wantsThinking(mode: ChatMode): boolean {
  return mode === "thinking";
}

/** Output token ceiling per model call: thinking needs headroom. */
export function maxTokensFor(mode: ChatMode): number {
  return mode === "thinking" ? 16_000 : 4_096;
}

/** UI: does the trace stay expanded after the run settles? */
export function traceStaysOpen(mode: ChatMode): boolean {
  return mode === "verbose" || mode === "debug";
}

/** Whether the model/vendor can honour Thinking mode (label shown otherwise). */
export function supportsThinking(vendor: string): boolean {
  return vendor === "anthropic";
}

/**
 * Per-chat composer preferences: the mode, and whether capability chips are
 * picked automatically per message (`capsAuto`) or fixed manually (`caps`).
 */
export const chatPrefsSchema = z.object({
  mode: chatModeSchema.catch(DEFAULT_CHAT_MODE).default(DEFAULT_CHAT_MODE),
  capsAuto: z.boolean().catch(true).default(true),
  caps: z.array(z.string().max(32)).max(12).catch([]).default([]),
});
export type ChatPrefs = z.infer<typeof chatPrefsSchema>;
export const DEFAULT_CHAT_PREFS: ChatPrefs = { mode: DEFAULT_CHAT_MODE, capsAuto: true, caps: [] };

export function parseChatPrefs(value: unknown): ChatPrefs {
  if (typeof value === "string") return { ...DEFAULT_CHAT_PREFS, mode: parseChatMode(value) };
  const parsed = chatPrefsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_CHAT_PREFS };
}
