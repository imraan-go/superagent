import { describe, expect, it } from "vitest";
import { pushSample, sparkPoints } from "@/lib/manage/sparkline";
import { isProtectedPath, normalizePersistPath, parseLs } from "@/lib/manage/persist-paths";
import { advanceFollow, grepLines, INITIAL_FOLLOW, lineSecond } from "@/lib/manage/log-follow";
import { formatUptime, percentOf, usageTone } from "@/lib/manage/thresholds";

describe("sparkline buffer", () => {
  it("keeps only the last window and ignores out-of-order samples", () => {
    const min = 60_000;
    let s = pushSample([], { t: 0, v: 1 }, 30 * min);
    s = pushSample(s, { t: 10 * min, v: 2 }, 30 * min);
    s = pushSample(s, { t: 31 * min, v: 3 }, 30 * min);
    expect(s.map((x) => x.v)).toEqual([2, 3]);
    s = pushSample(s, { t: 20 * min, v: 9 }, 30 * min);
    expect(s.map((x) => x.v)).toEqual([2, 3]);
  });

  it("renders points pinned to the right edge with a fixed max", () => {
    const pts = sparkPoints([{ t: 1000, v: 50 }], 100, 20, { max: 100, windowMs: 1000 });
    expect(pts).toBe("100.0,10.0");
    expect(sparkPoints([], 10, 10)).toBe("");
  });
});

describe("persist paths", () => {
  it("normalises and rejects traversal", () => {
    expect(normalizePersistPath("")).toBe("");
    expect(normalizePersistPath("~/persist/work//a/./b")).toBe("work/a/b");
    expect(normalizePersistPath("../etc")).toBeNull();
    expect(normalizePersistPath("a/../../b")).toBeNull();
    expect(normalizePersistPath("/etc/passwd")).toBeNull();
    expect(normalizePersistPath("a\\b")).toBeNull();
  });

  it("protects secrets, browser state and anything unsafe", () => {
    for (const p of ["rdp_pass", "chrome-cdp", "chrome-cdp/Default/Cookies", ".sync-stamp", "work/rdp_pass", "../x", "/abs"]) {
      expect(isProtectedPath(p), p).toBe(true);
    }
    for (const p of ["work", "work/notes.txt", "feature-test.txt", "downloads/chrome-cdp-notes.txt"]) {
      expect(isProtectedPath(p), p).toBe(false);
    }
  });

  it("parses ls -la output and flags protected entries", () => {
    const text = [
      "total 14",
      "drwxr-xr-x  8 user user 4096 Oct 15 08:12 .",
      "drwxr-x--- 18 user user 4096 Oct 15 08:15 ..",
      "-rw-r--r--  1 user user   11 Oct 15 11:52 .sync-stamp",
      "drwx------ 33 user user 4096 Oct 15 11:52 chrome-cdp",
      "-rw-------  1 user user   16 Oct 15 08:02 rdp_pass",
      "-rw-r--r--  1 user user    2 Oct 14 06:47 feature test.txt",
      "drwxr-xr-x  2 user user  128 Oct 15 08:05 backups",
      "lrwxrwxrwx  1 user user    4 Oct  1  2025 latest -> work",
    ].join("\n");
    const e = parseLs(text, "");
    expect(e.map((x) => x.name)).toEqual(["backups", "chrome-cdp", ".sync-stamp", "feature test.txt", "latest", "rdp_pass"]);
    expect(e.find((x) => x.name === "rdp_pass")?.protected).toBe(true);
    expect(e.find((x) => x.name === "chrome-cdp")?.type).toBe("dir");
    expect(e.find((x) => x.name === "backups")?.protected).toBe(false);
    expect(e.find((x) => x.name === "latest")?.type).toBe("link");
    expect(parseLs("-rw-r--r-- 1 u u 5 Oct 15 08:12 a", "chrome-cdp")[0]?.protected).toBe(true);
  });
});

describe("log follow diffing", () => {
  const l = (sec: string, msg: string) => `2026-10-15T10:00:${sec}+0000 host unit[1]: ${msg}`;

  it("extracts the second from a short-iso stamp", () => {
    expect(lineSecond(l("05", "x"))).toBe("2026-10-15 10:00:05");
    expect(lineSecond("-- no entries --")).toBeNull();
  });

  it("delivers everything first, then only new lines despite inclusive since", () => {
    const first = [l("01", "a"), l("02", "b"), l("02", "b")];
    const r1 = advanceFollow(INITIAL_FOLLOW, first);
    expect(r1.fresh).toEqual(first);
    expect(r1.next.since).toBe("2026-10-15 10:00:02");

    // bridge re-returns the boundary second plus one new line and a third duplicate
    const poll2 = [l("02", "b"), l("02", "b"), l("02", "b"), l("03", "c")];
    const r2 = advanceFollow(r1.next, poll2);
    expect(r2.fresh).toEqual([l("02", "b"), l("03", "c")]);
    expect(r2.next.since).toBe("2026-10-15 10:00:03");
    expect(r2.next.boundary).toEqual([l("03", "c")]);

    const r3 = advanceFollow(r2.next, [l("03", "c")]);
    expect(r3.fresh).toEqual([]);
    expect(r3.next).toEqual(r2.next);
  });

  it("keeps state on an empty poll and greps case-insensitively", () => {
    const st = { since: "2026-10-15 10:00:02", boundary: ["x"] };
    expect(advanceFollow(st, []).next).toBe(st);
    expect(grepLines(["Error: boom", "ok"], "error")).toEqual(["Error: boom"]);
    expect(grepLines(["a"], "  ")).toEqual(["a"]);
  });
});

describe("thresholds", () => {
  it("tones at 80/90", () => {
    expect(usageTone(79.9)).toBe("default");
    expect(usageTone(80)).toBe("amber");
    expect(usageTone(89.9)).toBe("amber");
    expect(usageTone(90)).toBe("danger");
  });
  it("percent and uptime helpers", () => {
    expect(percentOf(1, 4)).toBe(25);
    expect(percentOf(1, 0)).toBe(0);
    expect(formatUptime(90_000)).toBe("1d 1h");
    expect(formatUptime(125)).toBe("2m");
  });
});
