import { describe, expect, it } from "vitest";
import { defaultApprovalPatterns, requiresApproval } from "@/server/agent/policy";

/**
 * A false negative here lets the agent post, pay or delete without asking —
 * the one failure mode the whole approval system exists to prevent.
 */
describe("requiresApproval", () => {
  it("stops irreversible outbound actions", () => {
    const blocked = [
      "post_tweet",
      "send_email",
      "mail_send",
      "publish_article",
      "submit_form",
      "reply_to_comment",
      "x_dm_user",
    ];
    for (const tool of blocked) {
      expect(requiresApproval(tool).required, tool).toBe(true);
    }
  });

  it("stops anything that spends money", () => {
    for (const tool of ["stripe_pay", "checkout_cart", "place_order", "transfer_funds"]) {
      expect(requiresApproval(tool).required, tool).toBe(true);
    }
  });

  it("stops destructive actions", () => {
    for (const tool of ["file_delete", "drop_table", "trash_message", "purge_cache"]) {
      expect(requiresApproval(tool).required, tool).toBe(true);
    }
  });

  it("lets read-only and desktop navigation through", () => {
    const allowed = [
      "desktop_screenshot",
      "desktop_click",
      "desktop_type",
      "screen_text",
      "browser_open_tab",
      "search_web",
      "schedule_list",
    ];
    for (const tool of allowed) {
      expect(requiresApproval(tool).required, tool).toBe(false);
    }
  });

  it("explains which rule matched, for the approval card", () => {
    expect(requiresApproval("post_tweet").reason).toBe('"post" is irreversible');
    expect(requiresApproval("file_delete").reason).toBe('"delete" is irreversible');
    expect(requiresApproval("desktop_click").reason).toBeNull();
  });

  it("honours extra patterns from Settings", () => {
    const policy = { extraPatterns: ["^rdp_"] };
    expect(requiresApproval("rdp_connect", policy).required).toBe(true);
    expect(requiresApproval("rdp_connect").required).toBe(false);
  });

  it("lets the owner clear a pattern they added, but never a default", () => {
    const policy = { extraPatterns: ["^rdp_"], allowlist: ["rdp_connect", "post_tweet"] };
    expect(requiresApproval("rdp_connect", policy).required).toBe(false);
    // Allowlisting an irreversible default must not disable the gate.
    expect(requiresApproval("post_tweet", policy).required).toBe(true);
  });

  it("ignores a malformed custom pattern instead of failing open", () => {
    const policy = { extraPatterns: ["([unclosed"] };
    expect(() => requiresApproval("desktop_click", policy)).not.toThrow();
    expect(requiresApproval("post_tweet", policy).required).toBe(true);
  });

  it("does not match a verb embedded in an unrelated word", () => {
    // "composer" contains "post"; "undelete" is not "delete".
    expect(requiresApproval("open_composer").required).toBe(false);
    expect(requiresApproval("screenshot_poster_image").required).toBe(false);
  });
});

describe("defaultApprovalPatterns", () => {
  it("exposes the non-removable list for Settings", () => {
    expect(defaultApprovalPatterns().length).toBeGreaterThan(3);
  });
});
