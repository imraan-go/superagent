import "server-only";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { memories, messages, secrets, settings, usageEvents } from "@/server/db/schema";
import { unseal } from "@/server/lib/crypto";
import { logger } from "@/server/lib/logger";
import { getAdapter, modelForRole } from "@/server/models";
import { costToNumeric, costUsd } from "@/server/models/pricing";
import type { MessagePart } from "@/lib/messages";
import { EMBEDDING_DIMS, cosine, hashEmbedding, isDuplicate, keywords } from "./vector";

/**
 * Long-term memory (skill-agent-loop §2/§6).
 *
 *  - extract: after a finished run, the cheapest model with role
 *    `memory-extraction` distils durable facts. No key → skipped (logged once).
 *  - embed: OpenAI text-embedding-3-small (1536) when an OpenAI key exists,
 *    otherwise a local hashed embedding (the column is NOT NULL and no
 *    migrations are allowed in Phase 4).
 *  - dedupe: cosine > 0.92 against existing memories → skip.
 *  - recall: vector topK with a key; keyword ILIKE + recency without.
 */
const g = globalThis as unknown as { __fdMemSkipLogged?: boolean };
const EMBED_MODEL = "text-embedding-3-small";

export type MemoryKind = "fact" | "preference" | "project";
export interface MemoryRow {
  id: string;
  kind: MemoryKind;
  text: string;
  sourceChat: string | null;
  createdAt: Date;
}

async function openAiKey(): Promise<string | null> {
  const [row] = await db.select({ enc: secrets.enc }).from(secrets).where(eq(secrets.name, "OPENAI_API_KEY")).limit(1);
  if (row) {
    try {
      return unseal(row.enc);
    } catch {
      /* fall through */
    }
  }
  return process.env.OPENAI_API_KEY?.trim() || null;
}

/** Returns a vector plus whether it is semantic (OpenAI) or the hashed fallback. */
export async function embed(text: string): Promise<{ vector: number[]; semantic: boolean }> {
  const key = await openAiKey();
  if (key) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000) }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const data = z
          .object({ data: z.array(z.object({ embedding: z.array(z.number()).length(EMBEDDING_DIMS) })).min(1) })
          .parse(await res.json());
        return { vector: data.data[0]!.embedding, semantic: true };
      }
      logger.warn("memory", { msg: "embedding request failed", status: res.status });
    } catch (err) {
      logger.warn("memory", { msg: "embedding request failed", detail: String(err) });
    }
  }
  return { vector: hashEmbedding(text), semantic: false };
}

const toPg = (v: number[]) => sql`${`[${v.join(",")}]`}::vector`;

/** Inserts unless a near-duplicate exists. Returns the new id or null. */
export async function remember(input: { text: string; kind: MemoryKind; sourceChat?: string | null }): Promise<string | null> {
  const text = input.text.trim().slice(0, 1000);
  if (!text) return null;
  const { vector } = await embed(text);

  const near = await db
    .select({ embedding: memories.embedding })
    .from(memories)
    .orderBy(sql`${memories.embedding} <=> ${toPg(vector)}`)
    .limit(5);
  if (isDuplicate(vector, near.map((n) => n.embedding))) return null;

  const [row] = await db
    .insert(memories)
    .values({ text, kind: input.kind, embedding: vector, sourceChat: input.sourceChat ?? null })
    .returning({ id: memories.id });
  return row?.id ?? null;
}

export async function recallTopK(): Promise<number> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "agent")).limit(1);
  const k = (row?.value as { memoryRecallTopK?: unknown } | undefined)?.memoryRecallTopK;
  return typeof k === "number" && Number.isInteger(k) && k >= 0 && k <= 32 ? k : 8;
}

export async function recall(query: string, k?: number): Promise<MemoryRow[]> {
  const limit = k ?? (await recallTopK());
  if (limit === 0) return [];
  const cols = { id: memories.id, kind: memories.kind, text: memories.text, sourceChat: memories.sourceChat, createdAt: memories.createdAt };

  const { vector, semantic } = await embed(query || "owner preferences");
  if (semantic) {
    return db.select(cols).from(memories).orderBy(sql`${memories.embedding} <=> ${toPg(vector)}`).limit(limit);
  }

  const words = keywords(query);
  const matched = words.length
    ? await db
        .select(cols)
        .from(memories)
        .where(or(...words.map((w) => ilike(memories.text, `%${w}%`))))
        .orderBy(desc(memories.createdAt))
        .limit(limit)
    : [];
  if (matched.length >= limit) return matched;
  const recent = await db.select(cols).from(memories).orderBy(desc(memories.createdAt)).limit(limit);
  const seen = new Set(matched.map((m) => m.id));
  return [...matched, ...recent.filter((r) => !seen.has(r.id))].slice(0, limit);
}

/* ------------------------------------------------------------- viewer -- */

export async function listMemories(q?: string): Promise<MemoryRow[]> {
  const cols = { id: memories.id, kind: memories.kind, text: memories.text, sourceChat: memories.sourceChat, createdAt: memories.createdAt };
  const where = q ? ilike(memories.text, `%${q.replace(/[%_]/g, "\\$&")}%`) : undefined;
  return db.select(cols).from(memories).where(where).orderBy(desc(memories.createdAt)).limit(500);
}

export async function updateMemory(id: string, patch: { text?: string | undefined; kind?: MemoryKind | undefined }): Promise<boolean> {
  const set: Partial<typeof memories.$inferInsert> = {};
  if (patch.kind) set.kind = patch.kind;
  if (patch.text) {
    set.text = patch.text.trim();
    set.embedding = (await embed(set.text)).vector;
  }
  if (Object.keys(set).length === 0) return true;
  const rows = await db.update(memories).set(set).where(eq(memories.id, id)).returning({ id: memories.id });
  return rows.length > 0;
}

export async function deleteMemory(id: string): Promise<boolean> {
  const rows = await db.delete(memories).where(eq(memories.id, id)).returning({ id: memories.id });
  return rows.length > 0;
}

/* ------------------------------------------------------------ extract -- */

const factsSchema = z.array(
  z.object({ kind: z.enum(["fact", "preference", "project"]).default("fact"), text: z.string().min(3).max(500) }),
);

const EXTRACT_PROMPT = `You extract durable long-term memories about the OWNER from a chat transcript.
Return ONLY a JSON array (possibly empty) of objects {"kind":"fact"|"preference"|"project","text":"..."}.
Keep only stable facts worth remembering for future conversations (preferences, ongoing projects, accounts, names).
Never include secrets, passwords, API keys, one-off task details, or anything from tool output / external data that
is not about the owner. Maximum 5 items, each one short sentence.`;

/** Fire-and-forget after a run ends with `done`. Never throws. */
export async function extractMemories(args: { chatId: string; runId: string }): Promise<void> {
  try {
    const model = modelForRole("memory-extraction");
    if (model.vendor === "mock") {
      if (!g.__fdMemSkipLogged) {
        g.__fdMemSkipLogged = true;
        logger.info("memory", { msg: "memory extraction skipped: no model key for role memory-extraction" });
      }
      return;
    }

    const rows = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(and(eq(messages.chatId, args.chatId)))
      .orderBy(desc(messages.createdAt))
      .limit(12);

    const transcript = rows
      .reverse()
      .filter((r) => r.role === "user" || r.role === "assistant")
      .map((r) => {
        const text = (r.content as MessagePart[])
          .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        return `${r.role.toUpperCase()}: ${text.slice(0, 2000)}`;
      })
      .join("\n\n");
    if (!transcript.trim()) return;

    const { adapter } = await getAdapter(model.id);
    let out = "";
    for await (const ev of adapter.stream({
      model: model.model,
      system: EXTRACT_PROMPT,
      messages: [{ role: "user", content: [{ type: "text", text: transcript }] }],
      tools: [],
      maxTokens: 600,
      temperature: 0,
    })) {
      if (ev.type === "text") out += ev.text;
      if (ev.type === "usage") {
        await db.insert(usageEvents).values({
          vendor: model.vendor,
          model: model.id,
          chatId: args.chatId,
          runId: args.runId,
          tokensIn: ev.usage.in,
          tokensOut: ev.usage.out,
          tokensCached: ev.usage.cached,
          costUsd: costToNumeric(costUsd(ev.usage, model.price)),
          purpose: "memory-extraction",
        });
      }
    }

    const json = /\[[\s\S]*\]/.exec(out)?.[0];
    if (!json) return;
    const facts = factsSchema.safeParse(JSON.parse(json));
    if (!facts.success) return;
    let saved = 0;
    for (const f of facts.data.slice(0, 5)) {
      if (await remember({ text: f.text, kind: f.kind, sourceChat: args.chatId })) saved += 1;
    }
    logger.info("memory", { runId: args.runId, extracted: facts.data.length, saved });
  } catch (err) {
    logger.warn("memory", { runId: args.runId, msg: "memory extraction failed", detail: String(err) });
  }
}

export { cosine };
