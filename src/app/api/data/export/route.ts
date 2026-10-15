import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { chats, messages } from "@/server/db/schema";
import { ownerRoute } from "@/server/lib/route";
import { enforceRateLimit } from "@/server/lib/rate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Settings → Data: every chat with its messages as one JSON download.
 * Images are referenced by file id (ADR-07), not inlined.
 */
export const GET = ownerRoute(async ({ owner }) => {
  enforceRateLimit("export");
  const chatRows = await db
    .select()
    .from(chats)
    .where(eq(chats.userId, owner.userId))
    .orderBy(asc(chats.createdAt));

  const ids = chatRows.map((c) => c.id);
  const messageRows = ids.length
    ? await db
        .select({
          id: messages.id,
          chatId: messages.chatId,
          runId: messages.runId,
          role: messages.role,
          content: messages.content,
          model: messages.model,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(inArray(messages.chatId, ids))
        .orderBy(asc(messages.createdAt))
    : [];

  const byChat = new Map<string, typeof messageRows>();
  for (const m of messageRows) {
    const list = byChat.get(m.chatId) ?? [];
    list.push(m);
    byChat.set(m.chatId, list);
  }

  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      chats: chatRows.map((c) => ({
        id: c.id,
        title: c.title,
        pinned: c.pinned,
        archived: c.archived,
        model: c.model,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messages: (byChat.get(c.id) ?? []).map((m) => ({
          id: m.id,
          runId: m.runId,
          role: m.role,
          content: m.content,
          model: m.model,
          createdAt: m.createdAt,
        })),
      })),
    },
    null,
    2,
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="chats-${stamp}.json"`,
      "cache-control": "no-store",
    },
  });
});
