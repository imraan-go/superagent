import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { settings } from "@/server/db/schema";
import { DEFAULT_CHAT_PREFS, parseChatPrefs } from "@/lib/chat-mode";
import type { ChatMode, ChatPrefs } from "@/lib/chat-mode";

/**
 * A chat's composer preferences (conversation mode + Auto/manual capability
 * chips), stored as one `settings` row keyed per chat (`chat-prefs:<chatId>`).
 * The chats table has no JSON column, and a migration for this would be
 * heavier than a keyed row. Absent row = defaults (Default mode, Auto chips).
 */
export function chatPrefsKey(chatId: string): string {
  return `chat-prefs:${chatId}`;
}

export async function getChatPrefs(chatId: string): Promise<ChatPrefs> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, chatPrefsKey(chatId)))
    .limit(1);
  return row ? parseChatPrefs(row.value) : { ...DEFAULT_CHAT_PREFS };
}

export async function getChatMode(chatId: string): Promise<ChatMode> {
  return (await getChatPrefs(chatId)).mode;
}

/** Merges a patch into the stored prefs and returns the result. */
export async function updateChatPrefs(chatId: string, patch: Partial<ChatPrefs>): Promise<ChatPrefs> {
  const next = parseChatPrefs({ ...(await getChatPrefs(chatId)), ...patch });
  const key = chatPrefsKey(chatId);
  await db
    .insert(settings)
    .values({ key, value: next, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
  return next;
}

export async function deleteChatPrefs(chatId: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, chatPrefsKey(chatId)));
}
