import { describe, expect, it } from "vitest";
import { classifyCapabilities } from "@/lib/auto-capabilities";
import { narrowByCapabilities } from "@/lib/capabilities";

const cases: Array<[string, string[]]> = [
  ["Connect to my Windows PC and open Notepad++", ["rdp", "computer"]],
  ["type the release notes into notepad++ on windows", ["rdp", "computer"]],
  ["Open the LinkedIn feed and tell me the top 3 posts", ["connectors", "browser", "computer"]],
  ["Post this draft to LinkedIn", ["connectors", "browser", "computer"]],
  ["Add a page to my Notion workspace with today's notes", ["connectors", "browser", "computer"]],
  ["check my gmail for invoices from last week", ["connectors", "browser", "computer"]],
  ["what's on my calendar tomorrow?", ["connectors", "browser", "computer"]],
  ["open https://example.com in the Linux browser and read the heading", ["browser", "computer"]],
  ["search the web for the latest Next.js release notes", ["browser", "computer"]],
  ["look up the price of a Raspberry Pi 5", ["browser", "computer"]],
  ["go to news.ycombinator.com and list the top stories", ["browser", "computer"]],
  ["run `uname -a` and summarise", ["computer"]],
  ["list files in ~/persist and tell me the 3 newest", ["computer"]],
  ["describe what's on the agent computer's screen", ["computer"]],
  ["list saved workflows and schedules", ["computer"]],
  ["check RDP status and list RDP profiles", ["rdp", "computer"]],
  ["fetch the report from %USERPROFILE%\\Downloads on my pc", ["rdp", "computer"]],
  ["post a message in the #general Slack channel", ["connectors", "browser", "computer"]],
  ["remember that I prefer short answers", ["memory"]],
  ["hello, how are you?", []],
  ["what do you think about this plan", []],
];

describe("auto capability classifier", () => {
  it.each(cases)("%s", (prompt, want) => {
    const pick = classifyCapabilities(prompt);
    expect(pick.chosen).toEqual(want);
    expect(pick.reasons.length).toBeGreaterThan(0);
  });

  it("ignores negated mentions", () => {
    expect(classifyCapabilities("Run `uname -a`. Do not connect to RDP or post anything.").chosen).toEqual(["computer"]);
    expect(classifyCapabilities("summarise this without opening a browser").chosen).toEqual([]);
  });

  it("explains its matches", () => {
    expect(classifyCapabilities("open notepad++ on windows").reasons.join(" ")).toMatch(/→ RDP/);
  });

  it("uses connected toolkit names", () => {
    const pick = classifyCapabilities("sync the acmecrm leads", ["acmecrm"]);
    expect(pick.chosen).toContain("connectors");
    expect(pick.reasons[0]).toMatch(/acmecrm/);
  });

  it("never fails closed and never widens the allowlist", () => {
    const allowed = [{ name: "observe" }, { name: "run_command" }];
    expect(narrowByCapabilities(allowed, classifyCapabilities("hi").chosen)).toEqual(allowed);
    const rdp = narrowByCapabilities(allowed, classifyCapabilities("open notepad on windows").chosen);
    expect(rdp.every((t) => allowed.includes(t))).toBe(true);
    expect(rdp.map((t) => t.name)).not.toContain("rdp_type");
  });
});
