import { describe, expect, it } from "vitest";
import { formatAge, newItems, pendingPollMs } from "@/lib/hitl";
import type { PendingItem } from "@/lib/hitl";
import {
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_SOUND_PREFS,
  notificationPrefsSchema,
  parseSection,
  soundEnabled,
  soundPrefsSchema,
} from "@/lib/prefs";
import { CUES } from "@/lib/sound-cues";

const item = (id: string, kind: PendingItem["kind"] = "confirm"): PendingItem => ({
  id,
  source: "lhos",
  kind,
  prompt: "p",
  createdAt: "2026-10-15T00:00:00.000Z",
  runId: null,
  chatId: null,
});

describe("pending polling", () => {
  it("polls fast while anything is live, slow otherwise", () => {
    expect(pendingPollMs(undefined)).toBe(60_000);
    expect(pendingPollMs({ count: 0, running: 0 })).toBe(60_000);
    expect(pendingPollMs({ count: 1, running: 0 })).toBe(5_000);
    expect(pendingPollMs({ count: 0, running: 2 })).toBe(5_000);
    expect(pendingPollMs({ count: 0, running: 0 }, true)).toBe(5_000);
  });

  it("announces only items that were not there last poll, never on first load", () => {
    expect(newItems(undefined, [item("a")])).toEqual([]);
    expect(newItems([item("a")], [item("a"), item("b")]).map((i) => i.id)).toEqual(["b"]);
    expect(newItems([item("a"), item("b")], [item("b")])).toEqual([]);
  });

  it("formats ages compactly", () => {
    const t = Date.parse("2026-10-15T00:00:00.000Z");
    expect(formatAge("2026-10-15T00:00:00.000Z", t + 10_000)).toBe("just now");
    expect(formatAge("2026-10-15T00:00:00.000Z", t + 5 * 60_000)).toBe("5m");
    expect(formatAge("2026-10-15T00:00:00.000Z", t + 3 * 3_600_000)).toBe("3h");
  });
});

describe("sound & notification prefs", () => {
  it("falls back to the schema defaults", () => {
    expect(DEFAULT_SOUND_PREFS.volume).toBe(0.3);
    expect(DEFAULT_SOUND_PREFS.master).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFS.chrome).toBe(false);
    expect(DEFAULT_NOTIFICATION_PREFS.events).toContain("approval");
    expect(parseSection(soundPrefsSchema, "sound", null)).toEqual(DEFAULT_SOUND_PREFS);
  });

  it("accepts a bare or wrapped section and repairs bad fields", () => {
    expect(parseSection(soundPrefsSchema, "sound", { volume: 0.5 }).volume).toBe(0.5);
    expect(parseSection(soundPrefsSchema, "sound", { sound: { master: false } }).master).toBe(false);
    expect(parseSection(soundPrefsSchema, "sound", { volume: 7 }).volume).toBe(0.3);
    expect(
      parseSection(notificationPrefsSchema, "notifications", { chrome: true, events: ["runDone"] }),
    ).toEqual({ chrome: true, events: ["runDone"] });
  });

  it("respects master, per-event toggles and Manage mode", () => {
    const off = { ...DEFAULT_SOUND_PREFS, events: { ...DEFAULT_SOUND_PREFS.events, done: false } };
    expect(soundEnabled(DEFAULT_SOUND_PREFS, "send", false)).toBe(true);
    expect(soundEnabled(DEFAULT_SOUND_PREFS, "send", true)).toBe(false);
    expect(soundEnabled(off, "done", false)).toBe(false);
    expect(soundEnabled({ ...DEFAULT_SOUND_PREFS, master: false }, "error", false)).toBe(false);
  });

  it("defines a short cue for every event", () => {
    for (const [name, tones] of Object.entries(CUES)) {
      expect(tones.length, name).toBeGreaterThan(0);
      for (const t of tones) expect(t.at + t.dur, name).toBeLessThan(1);
    }
    expect(CUES.send.map((t) => t.freq)).toEqual([660, 880]);
    expect(CUES.approval.map((t) => t.freq)).toEqual([440, 440]);
  });
});
