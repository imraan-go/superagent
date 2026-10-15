import type { ChatSummary } from "./api";

export interface ChatGroup {
  key: "pinned" | "today" | "yesterday" | "week" | "older";
  label: string;
  chats: ChatSummary[];
}

/**
 * Sidebar grouping. Pinned stay at the top regardless of age; everything else
 * buckets by `updatedAt` so a chat the owner just touched surfaces under Today.
 */
export function groupChats(chats: ChatSummary[], now: Date = new Date()): ChatGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  const pinned: ChatSummary[] = [];
  const buckets: Record<Exclude<ChatGroup["key"], "pinned">, ChatSummary[]> = {
    today: [],
    yesterday: [],
    week: [],
    older: [],
  };

  for (const chat of chats) {
    if (chat.pinned) {
      pinned.push(chat);
      continue;
    }
    const t = new Date(chat.updatedAt);
    if (t >= startOfToday) buckets.today.push(chat);
    else if (t >= startOfYesterday) buckets.yesterday.push(chat);
    else if (t >= startOfWeek) buckets.week.push(chat);
    else buckets.older.push(chat);
  }

  const groups: ChatGroup[] = [];
  if (pinned.length) groups.push({ key: "pinned", label: "Pinned", chats: pinned });
  if (buckets.today.length) groups.push({ key: "today", label: "Today", chats: buckets.today });
  if (buckets.yesterday.length) {
    groups.push({ key: "yesterday", label: "Yesterday", chats: buckets.yesterday });
  }
  if (buckets.week.length) groups.push({ key: "week", label: "Previous 7 days", chats: buckets.week });
  if (buckets.older.length) groups.push({ key: "older", label: "Older", chats: buckets.older });
  return groups;
}
