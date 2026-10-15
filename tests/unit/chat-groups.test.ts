import { describe, expect, it } from "vitest";
import { groupChats } from "@/lib/chat-groups";
import type { ChatSummary } from "@/lib/api";

function chat(partial: Partial<ChatSummary> & { id: string; title: string }): ChatSummary {
  return {
    pinned: false,
    archived: false,
    model: null,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T12:00:00.000Z",
    status: null,
    statusLine: null,
    ...partial,
  };
}

const NOW = new Date(2026, 9, 15, 18, 0, 0);

function daysAgo(days: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

describe("groupChats", () => {
  it("keeps pinned above age buckets", () => {
    const groups = groupChats(
      [
        chat({ id: "old", title: "Old", updatedAt: daysAgo(40) }),
        chat({
          id: "pin",
          title: "Pinned old",
          pinned: true,
          updatedAt: daysAgo(40),
        }),
      ],
      NOW,
    );

    expect(groups.map((g) => g.key)).toEqual(["pinned", "older"]);
    expect(groups[0]?.chats.map((c) => c.id)).toEqual(["pin"]);
  });

  it("buckets by updatedAt relative to today", () => {
    const groups = groupChats(
      [
        chat({ id: "t", title: "Today", updatedAt: daysAgo(0) }),
        chat({ id: "y", title: "Yesterday", updatedAt: daysAgo(1) }),
        chat({ id: "w", title: "This week", updatedAt: daysAgo(5) }),
        chat({ id: "o", title: "Older", updatedAt: daysAgo(40) }),
      ],
      NOW,
    );

    expect(groups.map((g) => [g.key, g.chats.map((c) => c.id)])).toEqual([
      ["today", ["t"]],
      ["yesterday", ["y"]],
      ["week", ["w"]],
      ["older", ["o"]],
    ]);
  });

  it("omits empty buckets", () => {
    const groups = groupChats(
      [chat({ id: "t", title: "Today", updatedAt: daysAgo(0) })],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(["today"]);
  });
});
