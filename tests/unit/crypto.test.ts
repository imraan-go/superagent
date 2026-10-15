import { beforeAll, describe, expect, it } from "vitest";

/**
 * `src/server/lib/crypto` reads PANEL_SECRET_KEY through the env loader, so the
 * environment has to be in place before the module graph is imported.
 */
let seal: (plain: string) => string;
let unseal: (sealed: string) => string;
let last4: (value: string) => string;
let timingSafeEqualStr: (a: string, b: string) => boolean;

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

  const mod = await import("@/server/lib/crypto");
  ({ seal, unseal, last4, timingSafeEqualStr } = mod);
});

describe("secret sealing", () => {
  it("round-trips a value", () => {
    const plain = "sk-ant-api03-not-a-real-key";
    expect(unseal(seal(plain))).toBe(plain);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const plain = "same-input";
    expect(seal(plain)).not.toBe(seal(plain));
  });

  it("round-trips unicode and empty strings", () => {
    expect(unseal(seal(""))).toBe("");
    expect(unseal(seal("ключ — 鍵 🔐"))).toBe("ключ — 鍵 🔐");
  });

  it("rejects a tampered ciphertext", () => {
    const sealed = seal("tamper-me");
    const buf = Buffer.from(sealed, "base64");
    // Flip a bit in the ciphertext body (past iv + auth tag).
    const target = buf.length - 1;
    buf[target] = (buf[target] ?? 0) ^ 0xff;
    expect(() => unseal(buf.toString("base64"))).toThrow();
  });

  it("rejects a truncated value", () => {
    expect(() => unseal(Buffer.alloc(8).toString("base64"))).toThrow(/malformed/);
  });
});

describe("last4", () => {
  it("exposes only the final four characters", () => {
    expect(last4("sk-ant-api03-abcdefgh")).toBe("efgh");
  });

  it("masks values too short to partially reveal", () => {
    expect(last4("abc")).toBe("••••");
  });
});

describe("timingSafeEqualStr", () => {
  it("matches identical strings and rejects others", () => {
    expect(timingSafeEqualStr("token", "token")).toBe(true);
    expect(timingSafeEqualStr("token", "tokeN")).toBe(false);
    expect(timingSafeEqualStr("token", "token-longer")).toBe(false);
  });
});
