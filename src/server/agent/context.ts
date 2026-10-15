import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { messages } from "@/server/db/schema";
import { lhos } from "@/server/lhos/client";
import { logger } from "@/server/lib/logger";
import type { AdapterMessage, AdapterPart } from "@/server/models/types";
import type { ModelEntry } from "@/server/models/catalog";
import type { MessagePart } from "@/lib/messages";

/**
 * Context assembly (skill-agent-loop §2), in order:
 *   system prompt → capability facts → recent chat turns.
 *
 * Memory recall over pgvector joins this in Phase 4; the ordering is already
 * correct so adding it is an insertion, not a rewrite.
 */
const RECENT_TURNS = 24;

export interface AgentContext {
  system: string;
  messages: AdapterMessage[];
}

const BASE_PROMPT = `You are the agent behind Flight Deck, a single-owner control panel.

You operate a real Linux desktop ("the agent computer") through the provided
tools. It is a live machine: take a screenshot before acting on anything visual,
and verify after acting rather than assuming a click landed.

Working rules:
- Prefer the smallest tool that answers the question. Reading the screen is
  cheaper than a screenshot.
- Say what you are about to do in one short sentence, then do it.
- If an action is irreversible (sending, posting, paying, deleting), call the
  tool anyway — the panel will stop and ask the owner before it executes. Never
  try to work around that pause.
- If you cannot proceed, say exactly what is blocking you and what you need.
- Do not claim an action succeeded unless a tool result confirms it.`;

export async function buildContext(args: {
  chatId: string;
  userId: string;
  model: ModelEntry;
  /** Settings → Agent. Layered on top of, never replacing, the base prompt. */
  systemPrompt?: string;
}): Promise<AgentContext> {
  const [facts, turns] = await Promise.all([
    capabilityFacts(),
    recentTurns(args.chatId),
  ]);

  // The base rules (approval pauses, verify-after-act) are safety-relevant, so
  // the owner's prompt is appended rather than substituted.
  const owner = args.systemPrompt?.trim();
  const sections = [
    BASE_PROMPT,
    owner ? `## Owner instructions\n${owner}` : null,
    facts ? `## The agent computer right now\n${facts}` : null,
  ].filter((s): s is string => Boolean(s));

  return {
    system: sections.join("\n\n"),
    messages: turns,
  };
}

/**
 * A compact status summary rather than the raw capabilities payload — the full
 * document is mostly irrelevant to the model and costs input tokens every turn.
 */
async function capabilityFacts(): Promise<string | null> {
  try {
    const capabilities = await lhos.getCapabilities();
    const lines = [
      `- Desktop: ${capabilities.desktop?.up ? "up" : "asleep (tools will wake it)"}`,
      `- Pace: ${capabilities.pace?.mode ?? "unknown"} (min ${capabilities.pace?.min_gap_s ?? "?"}s between actions)`,
    ];
    if (capabilities.rdp?.connected) {
      lines.push(`- Windows machine: connected (${capabilities.rdp.profile ?? "default"})`);
    }
    return lines.join("\n");
  } catch (err) {
    // The loop still works without this; the first tool call will report the
    // real state anyway.
    logger.debug("agent", { msg: "capability facts unavailable", detail: String(err) });
    return null;
  }
}

async function recentTurns(chatId: string): Promise<AdapterMessage[]> {
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.createdAt))
    .limit(RECENT_TURNS);

  const out: AdapterMessage[] = [];

  for (const row of rows.reverse()) {
    const parts = toAdapterParts((row.content ?? []) as MessagePart[]);
    if (parts.length === 0) continue;
    // Tool results are the agent's observations; vendors expect them on the
    // user side of the conversation.
    out.push({ role: row.role === "assistant" ? "assistant" : "user", content: parts });
  }

  return out;
}

/**
 * Translates stored message parts into adapter parts. Images are dropped here
 * rather than resolved — the files route that turns a `fileId` into bytes lands
 * in Phase 2.
 */
export function toAdapterParts(parts: MessagePart[]): AdapterPart[] {
  return parts.flatMap((part): AdapterPart[] => {
    switch (part.type) {
      case "text":
        return [{ type: "text", text: part.text }];
      case "tool_use":
        return [{ type: "tool_use", id: part.id, name: part.name, args: part.args }];
      case "tool_result":
        return [
          {
            type: "tool_result",
            toolUseId: part.toolUseId,
            ok: part.ok,
            text: part.text,
            images: [],
          },
        ];
      case "image":
        // Resolved to bytes once the files route exists (Phase 2).
        return [];
    }
  });
}
