import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { messages } from "@/server/db/schema";
import { lhos } from "@/server/lhos/client";
import { logger } from "@/server/lib/logger";
import type { AdapterMessage, AdapterPart } from "@/server/models/types";
import type { ModelEntry } from "@/server/models/catalog";
import type { FilePart, MessagePart } from "@/lib/messages";
import { formatBytes, isVisionMime } from "@/lib/uploads";
import { getFileRow, readFileBytes } from "@/server/files/store";
import { recall } from "@/server/memory";
import { UNTRUSTED_RULES, wrapUntrusted } from "./guard";
import { loadAgentGuide } from "./guide";
import { DEFAULT_CHAT_MODE, modeAddendum } from "@/lib/chat-mode";
import type { ChatMode } from "@/lib/chat-mode";

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
  /** `system` split for prompt caching: stable prefix + per-run tail. */
  systemParts: { stable: string; volatile: string };
  messages: AdapterMessage[];
  guideSource: "file" | "embedded";
}

const BASE_PROMPT = `You are the agent behind Flight Deck, a single-owner control panel.

You operate a real Linux desktop ("the agent computer") through the provided
tools, and through it the owner's Windows PC over RDP when asked. It is a live
machine: look before acting on anything visual (observe / screen_text first,
a screenshot when you need to see layout), and verify after acting rather than
assuming a click landed. Long tasks of 50-150 steps are normal; keep going
until the task is done and verified.

Working rules:
- Prefer the smallest tool that answers the question. Reading the screen is
  cheaper than a screenshot.
- Say what you are about to do in one short sentence, then do it.
- If an action is irreversible (sending, posting, paying, deleting), call the
  tool anyway — the panel will stop and ask the owner before it executes. Never
  try to work around that pause.
- If you cannot proceed, say exactly what is blocking you and what you need.
- Do not claim an action succeeded unless a tool result confirms it.

${UNTRUSTED_RULES}`;

export async function buildContext(args: {
  chatId: string;
  userId: string;
  model: ModelEntry;
  /** Settings → Agent. Layered on top of, never replacing, the base prompt. */
  systemPrompt?: string;
  mode?: ChatMode;
}): Promise<AgentContext> {
  const [facts, turns, guide] = await Promise.all([
    capabilityFacts(),
    recentTurns(args.chatId, args.model.vision),
    loadAgentGuide(),
  ]);
  const remembered = await memoryRecall(turns);

  // The base rules (approval pauses, verify-after-act) are safety-relevant, so
  // the owner's prompt is appended rather than substituted.
  const owner = args.systemPrompt?.trim();
  // Stable sections first (cached across steps and runs), volatile last.
  const stable = [
    BASE_PROMPT,
    owner ? `## Owner instructions\n${owner}` : null,
    guide.text || null,
    modeAddendum(args.mode ?? DEFAULT_CHAT_MODE),
  ].filter((s): s is string => Boolean(s)).join("\n\n");
  const volatile = [
    remembered ? `## What you remember about the owner (may be outdated)\n${remembered}` : null,
    facts ? `## The agent computer right now\n${facts}` : null,
  ].filter((s): s is string => Boolean(s)).join("\n\n");

  return {
    system: volatile ? `${stable}\n\n${volatile}` : stable,
    systemParts: { stable, volatile },
    messages: turns,
    guideSource: guide.source,
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

/** Memory recall keyed on the latest user text (skill-agent-loop §2). */
async function memoryRecall(turns: AdapterMessage[]): Promise<string | null> {
  try {
    const lastUser = [...turns].reverse().find((t) => t.role === "user");
    const query = (lastUser?.content ?? [])
      .map((p) => (p.type === "text" ? p.text : ""))
      .join(" ")
      .slice(0, 2000);
    const rows = await recall(query);
    // Memories are distilled from past runs (which saw external content), so
    // they are data, not instructions.
    return rows.length ? wrapUntrusted("memory", rows.map((m) => `- ${m.text}`).join("\n")) : null;
  } catch (err) {
    logger.debug("agent", { msg: "memory recall unavailable", detail: String(err) });
    return null;
  }
}

async function recentTurns(chatId: string, vision: boolean): Promise<AdapterMessage[]> {
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.createdAt))
    .limit(RECENT_TURNS);

  const out: AdapterMessage[] = [];

  for (const row of rows.reverse()) {
    const parts = await toAdapterParts((row.content ?? []) as MessagePart[], { vision });
    if (parts.length === 0) continue;
    // Tool results are the agent's observations; vendors expect them on the
    // user side of the conversation.
    out.push({ role: row.role === "assistant" ? "assistant" : "user", content: parts });
  }

  pruneOldImages(out);
  return out;
}

/** Inline cap for small text attachments; larger ones are referenced only. */
const INLINE_TEXT_BYTES = 16 * 1024;
/** Only the newest N screenshots are re-sent each turn; older ones cost tokens for little value. */
export const KEEP_RECENT_IMAGES = 3;

/**
 * Translates stored message parts into adapter parts, resolving file ids to
 * bytes. Images become image blocks only when the model supports vision;
 * everything else is a short text reference so the model still knows the file
 * exists.
 */
export async function toAdapterParts(
  parts: MessagePart[],
  opts: { vision: boolean },
): Promise<AdapterPart[]> {
  const out: AdapterPart[] = [];
  for (const part of parts) {
    switch (part.type) {
      case "text":
        out.push({ type: "text", text: part.text });
        break;
      case "tool_use":
        out.push({ type: "tool_use", id: part.id, name: part.name, args: part.args });
        break;
      case "tool_result": {
        const images = opts.vision ? await loadImages(part.images) : [];
        out.push({
          type: "tool_result",
          toolUseId: part.toolUseId,
          ok: part.ok,
          text: wrapUntrusted(`tool:${part.name}`, part.text),
          images,
        });
        break;
      }
      case "image": {
        const label = part.alt ?? "image";
        const [img] = opts.vision ? await loadImages([part.fileId]) : [];
        out.push(
          img
            ? { type: "image", mime: img.mime, data_b64: img.data_b64 }
            : {
                type: "text",
                text: `[Image attached: ${label} (file ${part.fileId})${
                  opts.vision ? " - could not be loaded" : " - this model cannot view images"
                }]`,
              },
        );
        break;
      }
      case "file":
        out.push({ type: "text", text: await describeFile(part) });
        break;
    }
  }
  return out;
}

async function loadImages(ids: string[]): Promise<Array<{ mime: string; data_b64: string }>> {
  const out: Array<{ mime: string; data_b64: string }> = [];
  for (const id of ids) {
    try {
      const row = await getFileRow(id);
      if (!row || !isVisionMime(row.mime)) continue;
      const bytes = await readFileBytes(row);
      out.push({ mime: row.mime, data_b64: bytes.toString("base64") });
    } catch (err) {
      logger.debug("agent", { msg: "image unavailable", id, detail: String(err) });
    }
  }
  return out;
}

async function describeFile(part: FilePart): Promise<string> {
  const head = `[File attached: ${part.name} (${part.mime}, ${formatBytes(part.bytes)}, file ${part.fileId})]`;
  if (!part.mime.startsWith("text/") && part.mime !== "application/json") return head;
  if (part.bytes > INLINE_TEXT_BYTES) return `${head}\n(too large to inline)`;
  try {
    const row = await getFileRow(part.fileId);
    if (!row) return head;
    const text = (await readFileBytes(row)).toString("utf8");
    return `${head}\n${wrapUntrusted(`file:${part.name}`, text.replace(/<\/?\s*file_content\b[^>]*>/gi, ""))}`;
  } catch {
    return head;
  }
}

/**
 * Replaces all but the newest `keep` images (in tool results and user turns)
 * with a text note. Mutates in place; run before every model call.
 */
export function pruneOldImages(messages: AdapterMessage[], keep = KEEP_RECENT_IMAGES): void {
  let seen = 0;
  for (let m = messages.length - 1; m >= 0; m -= 1) {
    const content = messages[m]?.content ?? [];
    for (let p = content.length - 1; p >= 0; p -= 1) {
      const part = content[p];
      if (!part) continue;
      if (part.type === "image") {
        seen += 1;
        if (seen > keep) content[p] = { type: "text", text: "[earlier image omitted to save tokens]" };
      } else if (part.type === "tool_result" && part.images.length > 0) {
        const kept: typeof part.images = [];
        for (let i = part.images.length - 1; i >= 0; i -= 1) {
          seen += 1;
          if (seen <= keep) kept.unshift(part.images[i]!);
        }
        const dropped = part.images.length - kept.length;
        content[p] = {
          ...part,
          images: kept,
          text: dropped > 0 ? `${part.text}\n[${dropped} earlier screenshot(s) omitted to save tokens]` : part.text,
        };
      }
    }
  }
}
