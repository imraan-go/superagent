import { describe, expect, it } from "vitest";
import {
  MAX_TITLE_LENGTH,
  deriveTitle,
  messageContentSchema,
  partsToText,
} from "@/lib/messages";
import { activityLabel, chatStatusLine } from "@/lib/activity";

describe("deriveTitle", () => {
  it("uses a short prompt verbatim", () => {
    expect(deriveTitle("Check the Semrush rankings")).toBe("Check the Semrush rankings");
  });

  it("collapses whitespace and newlines", () => {
    expect(deriveTitle("  Check   the\n\nrankings  ")).toBe("Check the rankings");
  });

  it("cuts long prompts on a word boundary with an ellipsis", () => {
    const title = deriveTitle(
      "Run a full keyword research report for an AI native development agency and summarise it",
    );
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH + 1);
    expect(title.endsWith("…")).toBe(true);
    // Never cuts mid-word.
    expect(title).not.toMatch(/\s…$/);
    expect(title.slice(0, -1).split(" ").at(-1)).not.toBe("");
  });

  it("falls back for an empty or whitespace-only prompt", () => {
    expect(deriveTitle("")).toBe("New chat");
    expect(deriveTitle("   \n ")).toBe("New chat");
  });

  it("hard-cuts a single unbroken token rather than returning nothing", () => {
    const title = deriveTitle("a".repeat(200));
    expect(title).toHaveLength(MAX_TITLE_LENGTH + 1);
  });
});

describe("partsToText", () => {
  it("joins text parts and ignores the rest", () => {
    const text = partsToText([
      { type: "text", text: "Open the report" },
      { type: "image", fileId: "0b6dd1e1-5f52-4f6f-9b6b-3c0e0e2f1a11", mime: "image/png" },
      { type: "text", text: "and summarise it" },
    ]);
    expect(text).toBe("Open the report\nand summarise it");
  });
});

describe("messageContentSchema", () => {
  it("accepts a multimodal turn", () => {
    const parts = messageContentSchema.parse([
      { type: "text", text: "Here is the screen" },
      {
        type: "tool_use",
        id: "toolu_1",
        name: "desktop_screenshot",
        args: { quality: 40 },
      },
      {
        type: "tool_result",
        toolUseId: "toolu_1",
        name: "desktop_screenshot",
        ok: true,
        ms: 428,
        text: "captured",
        images: ["0b6dd1e1-5f52-4f6f-9b6b-3c0e0e2f1a11"],
      },
    ]);
    expect(parts).toHaveLength(3);
  });

  it("rejects an inline base64 image — images are referenced by file id", () => {
    expect(() =>
      messageContentSchema.parse([
        { type: "image", data_b64: "iVBORw0KGgo=", mime: "image/png" },
      ]),
    ).toThrow();
  });
});

describe("activityLabel", () => {
  it("names common desktop tools in plain language", () => {
    expect(activityLabel("desktop_click")).toBe("Clicking around");
    expect(activityLabel("screen_text")).toBe("Reading the screen");
    expect(activityLabel("desktop_type")).toBe("Typing");
  });

  it("falls back to a prefix match for unlisted tools", () => {
    expect(activityLabel("browser_open_tab")).toBe("Browsing");
    expect(activityLabel("rdp_connect")).toBe("Working on the Windows machine");
  });

  it("never leaks a raw tool name", () => {
    expect(activityLabel("some_brand_new_tool")).toBe("Working");
    expect(activityLabel(null)).toBe("Thinking");
  });
});

describe("chatStatusLine", () => {
  it("describes a running chat by its current tool", () => {
    expect(chatStatusLine({ status: "running", toolName: "desktop_click" })).toBe(
      "Clicking around",
    );
  });

  it("prioritises states that need the owner", () => {
    expect(chatStatusLine({ status: "paused_approval" })).toBe("Needs your approval");
    expect(chatStatusLine({ status: "paused_question" })).toBe("Waiting on your answer");
  });

  it("shows nothing for a finished or absent run, so the row shows its timestamp", () => {
    expect(chatStatusLine({ status: "done" })).toBeNull();
    expect(chatStatusLine(null)).toBeNull();
  });
});
