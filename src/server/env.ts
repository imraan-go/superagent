import "server-only";
import { z } from "zod";

/**
 * Single source of truth for server configuration.
 *
 * Rules enforced here (`.cursor/rules/30-security.mdc`):
 *  - A missing or malformed required var fails loudly at boot, never silently.
 *  - Nothing in this module may be imported from a client component; the
 *    `server-only` import makes that a build error.
 *  - Values are never logged. Validation errors report the key name only.
 */

const base64Key32 = z
  .string()
  .min(1, "required")
  .refine((v) => Buffer.from(v, "base64").length >= 32, {
    message: "must be at least 32 bytes of base64 (generate with: openssl rand -base64 32)",
  });

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // App
  APP_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(3100),

  /** Session sealing + AES-256-GCM key for the `secrets` table. */
  PANEL_SECRET_KEY: base64Key32,

  // Owner account — the only login. Password hash is set by `owner:set-password`
  // and may legitimately be empty until that script has run once.
  OWNER_EMAIL: z.email().optional(),
  OWNER_PASSWORD_HASH: z.string().optional(),

  // Database
  DATABASE_URL: z.string().startsWith("postgres"),

  // LHOS agent server (populated by scripts/sync-env.sh)
  LHOS_BASE_URL: z.url(),
  LHOS_MCP_TOKEN: z.string().min(1),
  /** Human-only approvals token. Server-side proxy exclusively — never to a
   *  client, never into a model prompt (rule 30-security). */
  LHOS_APPROVE_TOKEN: z.string().min(1),
  LHOS_VNC_URL: z.url(),

  /** Where uploads live (outside the web root). Default: /var/lib/tj-lhos-panel/uploads in production, ./uploads in dev. */
  UPLOAD_DIR: z.string().optional(),

  // E2B core API (Manage mode)
  E2B_API_URL: z.url(),
  E2B_API_KEY: z.string().min(1),

  // Manage-mode host bridge (e2b-agent-vm/bin/host_bridge.py, loopback only)
  BRIDGE_URL: z.url().default("http://127.0.0.1:7071"),
  BRIDGE_TOKEN: z.string().min(1),

  // Model vendors — optional here; the owner may instead store them encrypted
  // via Settings → Models. Absence is a product state, not a config error.
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),

  // Connectors
  COMPOSIO_API_KEY: z.string().optional(),
  PIPEDREAM_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");

    throw new Error(
      [
        "Invalid server environment. The panel will not start.",
        problems,
        "",
        "Fix: run `bash scripts/sync-env.sh` to pull live LHOS tokens into",
        ".env.local, then fill the remaining keys from .env.example.",
      ].join("\n"),
    );
  }

  return parsed.data;
}

/** Empty-string env vars are treated as unset so `.optional()` behaves. */
for (const [key, value] of Object.entries(process.env)) {
  if (value === "") delete process.env[key];
}

export const env: Env = load();

/** Vendor keys present in the environment (Settings may add more at runtime). */
export const envVendorKeys = {
  anthropic: env.ANTHROPIC_API_KEY,
  openai: env.OPENAI_API_KEY,
  openrouter: env.OPENROUTER_API_KEY,
} as const;
