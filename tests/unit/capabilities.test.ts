import { describe, expect, it } from "vitest";
import { capabilityOf, narrowByCapabilities } from "@/lib/capabilities";

const tools = [
  "observe",
  "ask_user",
  "desktop_click",
  "run_command",
  "browser_goto",
  "rdp_type",
  "http_request",
  "composio__gmail__GMAIL_FETCH_EMAILS",
  "mcp__notion__search",
].map((name) => ({ name }));

describe("capability chips", () => {
  it("does not narrow when no chips are chosen", () => {
    expect(narrowByCapabilities(tools, [])).toHaveLength(tools.length);
    expect(narrowByCapabilities(tools, undefined)).toHaveLength(tools.length);
  });

  it("keeps observe + human-in-the-loop with any selection", () => {
    const names = narrowByCapabilities(tools, ["rdp"]).map((t) => t.name);
    // RDP is driven through the GUI family, so desktop_click comes along.
    expect(names).toEqual(expect.arrayContaining(["observe", "ask_user", "rdp_type", "desktop_click"]));
    expect(names).not.toContain("browser_goto");
    expect(names).not.toContain("run_command");
  });

  it("maps namespaced external tools", () => {
    expect(capabilityOf("composio__gmail__GMAIL_FETCH_EMAILS")).toBe("connectors");
    expect(capabilityOf("mcp__notion__search")).toBe("mcp");
    const names = narrowByCapabilities(tools, ["connectors"]).map((t) => t.name);
    expect(names).toContain("composio__gmail__GMAIL_FETCH_EMAILS");
    expect(names).not.toContain("mcp__notion__search");
  });

  it("ignores unknown chip values instead of widening", () => {
    expect(narrowByCapabilities(tools, ["everything"])).toHaveLength(tools.length);
  });

  it("only narrows — never adds tools that were not offered", () => {
    const offered = tools.slice(0, 2);
    expect(narrowByCapabilities(offered, ["browser"])).toEqual(offered);
  });
});
