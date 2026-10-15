import { beforeAll, describe, expect, it } from "vitest";
import schemaJson from "../../config/settings.schema.json";
import {
  DEFAULT_CHECKPOINT_PATTERNS,
  SETTINGS_SECTIONS,
  enforceCheckpointDefaults,
  mergeSection,
  paceArgs,
  parseStored,
  sectionDefaults,
  validateSection,
} from "@/lib/settings";
import { applyModelOverride, applyModelOverrides, pickDefaultModel } from "@/server/models/overrides";
import { costUsd } from "@/server/models/pricing";
import { DEFAULT_TOOL_ALLOWLIST, filterTools, resolveAllowlist } from "@/server/agent/allowlist";
import { compilePattern, requiresApproval } from "@/server/agent/policy";

type JsonProp = { default?: unknown; properties?: Record<string, JsonProp> };

describe("settings schema mirror", () => {
  it("covers exactly the JSON schema's sections", () => {
    expect([...SETTINGS_SECTIONS].sort()).toEqual(Object.keys(schemaJson.properties).sort());
  });

  it("applies the same defaults as config/settings.schema.json", () => {
    for (const section of SETTINGS_SECTIONS) {
      const props = (schemaJson.properties as Record<string, JsonProp>)[section]!.properties ?? {};
      const defaults = sectionDefaults(section) as Record<string, unknown>;
      for (const [key, prop] of Object.entries(props)) {
        if (prop.default !== undefined) {
          expect(defaults[key], `${section}.${key}`).toEqual(prop.default);
        }
        // Nested defaults (sound.events.*).
        for (const [sub, subProp] of Object.entries(prop.properties ?? {})) {
          if (subProp.default !== undefined) {
            expect((defaults[key] as Record<string, unknown>)[sub], `${section}.${key}.${sub}`).toEqual(
              subProp.default,
            );
          }
        }
      }
    }
  });

  it("returns complete defaults for a missing row", () => {
    expect(parseStored("sound", null)).toEqual({
      master: true,
      volume: 0.3,
      events: { send: true, done: true, approval: true, error: true, takeover: true },
    });
    expect(parseStored("agent", undefined).toolAllowlist).toBeUndefined();
  });

  it("salvages the valid fields of a corrupt row", () => {
    const value = parseStored("agent", { maxSteps: 9999, pace: "fast", junk: 1 });
    expect(value.maxSteps).toBe(120);
    expect(value.pace).toBe("fast");
  });

  it("rejects out-of-range writes", () => {
    expect(() => validateSection("sound", { volume: 2 })).toThrow();
    expect(() => validateSection("agent", { maxSteps: 0 })).toThrow();
    expect(() => validateSection("agent", { toolAllowlist: ["bad name"] })).toThrow();
    expect(() => validateSection("notifications", { events: ["nope"] })).toThrow();
  });
});

describe("mergeSection", () => {
  it("merges nested objects one level deep and replaces arrays", () => {
    const merged = mergeSection(sectionDefaults("sound"), { events: { send: false }, volume: 0.5 });
    expect(merged.volume).toBe(0.5);
    expect(merged.events).toEqual({ send: false, done: true, approval: true, error: true, takeover: true });

    const n = mergeSection(sectionDefaults("notifications"), { events: ["approval"] });
    expect(n.events).toEqual(["approval"]);
  });

  it("null clears an optional field", () => {
    const merged = mergeSection({ defaultModel: "x", maxSteps: 3 }, { defaultModel: null });
    expect(merged).toEqual({ maxSteps: 3 });
  });

  it("shallow mode replaces objects whole", () => {
    const merged = mergeSection({ overrides: { a: {}, b: {} } }, { overrides: { a: {} } }, { shallow: true });
    expect(merged.overrides).toEqual({ a: {} });
  });
});

describe("approvals can only get stricter", () => {
  it("re-adds removed defaults and dedupes", () => {
    const out = enforceCheckpointDefaults(["archive", "SEND", "archive"]);
    expect(out.slice(0, DEFAULT_CHECKPOINT_PATTERNS.length)).toEqual([...DEFAULT_CHECKPOINT_PATTERNS]);
    expect(out).toContain("archive");
    expect(out.filter((p) => p.toLowerCase() === "send")).toHaveLength(1);
  });

  it("validateSection enforces it on write", () => {
    const saved = validateSection("approvals", { checkpointPatterns: [] });
    expect(saved.checkpointPatterns).toEqual([...DEFAULT_CHECKPOINT_PATTERNS]);
  });

  it("bare verbs match whole words; regex sources work; bad regex is ignored", () => {
    expect(compilePattern("post")!.test("postgres_query")).toBe(false);
    expect(compilePattern("archive")!.test("mail_archive_thread")).toBe(true);
    expect(compilePattern("^rdp_")!.test("rdp_type")).toBe(true);
    expect(compilePattern("(")).toBeNull();

    expect(requiresApproval("mail_archive", { extraPatterns: ["archive"] }).required).toBe(true);
    expect(requiresApproval("mail_archive").required).toBe(false);
    // Defaults hold even with no extra patterns at all.
    expect(requiresApproval("browser_send_email", { extraPatterns: [] }).required).toBe(true);
  });
});

describe("tool allowlist resolution", () => {
  const tools = [{ name: "desktop_screenshot" }, { name: "rdp_type" }, { name: "run_command" }];

  it("absent setting → ADR-06 default", () => {
    expect(resolveAllowlist(undefined)).toBe(DEFAULT_TOOL_ALLOWLIST);
    expect(filterTools(tools, resolveAllowlist(undefined)).map((t) => t.name)).toEqual([
      "desktop_screenshot",
      "rdp_type",
      "run_command",
    ]);
  });

  it("explicit list is honoured, including empty", () => {
    expect(filterTools(tools, resolveAllowlist(["rdp_type"])).map((t) => t.name)).toEqual(["rdp_type"]);
    expect(filterTools(tools, resolveAllowlist([]))).toEqual([]);
  });
});

describe("model overrides", () => {
  const sonnet = { id: "a/sonnet", enabled: true, price: { in: 3, out: 15, cachedIn: 0.3 } };
  const gpt = { id: "o/gpt", enabled: false, price: { in: 10, out: 30 } };

  it("overrides price and enabled, leaving others untouched", () => {
    const [s, g] = applyModelOverrides([sonnet, gpt], {
      "a/sonnet": { price: { in: 1, out: 2 } },
      "o/gpt": { enabled: true },
    });
    expect(s!.price).toEqual({ in: 1, out: 2 });
    expect(s!.enabled).toBe(true);
    expect(g!.enabled).toBe(true);
    expect(g!.price).toEqual(gpt.price);
    expect(applyModelOverride(sonnet, {})).toBe(sonnet);
  });

  it("overridden price drives metering", () => {
    const priced = applyModelOverride(sonnet, { "a/sonnet": { price: { in: 2, out: 4 } } });
    expect(costUsd({ in: 1_000_000, out: 500_000, cached: 0 }, priced.price)).toBe(4);
  });

  it("default resolution skips disabled and keyless models", () => {
    const models = [sonnet, gpt, { id: "a/haiku", enabled: true, price: { in: 1, out: 1 } }];
    const ready = (m: { id: string }) => m.id !== "a/sonnet";
    expect(pickDefaultModel(["o/gpt", "a/sonnet", "a/haiku"], models, ready)?.id).toBe("a/haiku");
    expect(pickDefaultModel([undefined], models, () => false)).toBeUndefined();
  });
});

describe("pace mapping (ADR-08)", () => {
  it("maps to the live set_pace signature", () => {
    expect(paceArgs("fast")).toEqual({ mode: "fast", min_gap_seconds: 4, max_actions_per_hour: 60 });
    expect(paceArgs("careful")).toEqual({ mode: "careful", min_gap_seconds: 12, max_actions_per_hour: 20 });
  });
});

describe("vendor key sealing", () => {
  let seal: (plain: string) => string;
  let unseal: (sealed: string) => string;
  let last4: (value: string) => string;

  beforeAll(async () => {
    process.env.APP_URL ??= "http://localhost:3100";
    process.env.PANEL_SECRET_KEY ??= Buffer.alloc(32, 7).toString("base64");
    process.env.DATABASE_URL ??= "postgres://panel:panel@127.0.0.1:5433/panel";
    process.env.LHOS_BASE_URL ??= "https://mcp.example.test";
    process.env.LHOS_MCP_TOKEN ??= "test-token";
    process.env.LHOS_APPROVE_TOKEN ??= "test-approve-token";
    process.env.LHOS_VNC_URL ??= "https://vnc.example.test/";
    process.env.E2B_API_URL ??= "http://e2b.example.test:3000";
    process.env.E2B_API_KEY ??= "test-e2b-key";
    process.env.BRIDGE_TOKEN ??= "test-bridge-token";
    ({ seal, unseal, last4 } = await import("@/server/lib/crypto"));
  });

  it("round-trips a key and exposes only last4", () => {
    const key = "sk-test-000000000000abcd";
    const sealed = seal(key);
    expect(sealed).not.toContain("abcd");
    expect(unseal(sealed)).toBe(key);
    expect(last4(key)).toBe("abcd");
    // Fresh IV each time: equal keys never produce equal ciphertexts.
    expect(seal(key)).not.toBe(sealed);
  });
});
