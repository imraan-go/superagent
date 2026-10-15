import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_HEADER, GUIDE_MAX_CHARS, trimGuide } from "@/server/agent/guide-trim";
import { loadAgentGuide } from "@/server/agent/guide";

describe("operator guide", () => {
  it("drops lines naming locked tools and the identity line, keeps the know-how", () => {
    const raw = [
      "You are an autonomous computer operator.",
      "# The loop",
      "1. **Observe** — take a `desktop_screenshot` first.",
      "- `secret_intake_url` — a page where the user pastes a key.",
      "- Reusable playbooks: `workflow_save(name, steps)`.",
      "Enter text with **`rdp_type`**.",
      "The run returns `awaiting_approval` + `approval_id`.",
    ].join("\n");
    const out = trimGuide(raw);
    expect(out.startsWith(GUIDE_HEADER)).toBe(true);
    expect(out).toContain("desktop_screenshot");
    expect(out).toContain("rdp_type");
    expect(out).toContain("approval_id");
    expect(out).not.toContain("secret_intake_url");
    expect(out).not.toContain("workflow_save");
    expect(out).not.toContain("You are an autonomous");
  });

  it("caps the length", () => {
    expect(trimGuide("x\n".repeat(40_000)).length).toBeLessThan(GUIDE_MAX_CHARS + GUIDE_HEADER.length + 40);
  });

  it("reads LHOS_AGENT_GUIDE_PATH, and falls back to the embedded copy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "guide-"));
    const file = join(dir, "SYSTEM_PROMPT.md");
    writeFileSync(file, "# Loop\nUse `observe` first.");
    const live = await loadAgentGuide(file);
    expect(live.source).toBe("file");
    expect(live.text).toContain("Use `observe` first.");

    const missing = await loadAgentGuide(join(dir, "nope.md"));
    expect(missing.source).toBe("embedded");
    expect(missing.text).toContain("rdp_type");

    const unset = await loadAgentGuide(undefined);
    expect(unset.source).toBe("embedded");
  });
});
