/**
 * Creates or updates the single owner account.
 *
 *   npm run owner:set-password -- owner@example.com
 *
 * The password is read from a hidden TTY prompt, never from argv (which would
 * land in shell history and `ps`) and never from chat. The hash lives in the
 * `users` table — the database is the source of truth for the credential.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { count, eq } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { users } from "../src/server/db/schema";

const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const MIN_LENGTH = 12;

/**
 * Piped stdin (`… < secret-file`) is drained once up front. Asking readline for
 * a second line after the stream has ended returns a promise that never
 * settles, which would make the script exit silently.
 */
let pipedLines: string[] | null = null;

async function readPipedLine(): Promise<string> {
  if (pipedLines === null) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
    pipedLines = Buffer.concat(chunks).toString("utf8").split("\n");
  }
  return pipedLines.shift() ?? "";
}

async function promptHidden(question: string): Promise<string> {
  if (!stdin.isTTY) return readPipedLine();

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const originalWrite = stdout.write.bind(stdout);
  let muted = false;

  // Suppress echo once the prompt itself has been printed.
  stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) =>
    muted ? true : originalWrite(chunk, ...(args as []))) as typeof stdout.write;

  originalWrite(question);
  muted = true;
  try {
    const answer = await rl.question("");
    return answer;
  } finally {
    muted = false;
    stdout.write = originalWrite;
    originalWrite("\n");
    rl.close();
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — run `bash scripts/sync-env.sh`.");

  const email = (process.argv[2] ?? process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error(
      "Usage: npm run owner:set-password -- owner@example.com\n" +
        "(or set OWNER_EMAIL in .env.local)",
    );
  }

  const password = await promptHidden(`Password for ${email}: `);
  if (password.length < MIN_LENGTH) {
    throw new Error(`Password must be at least ${MIN_LENGTH} characters.`);
  }
  const again = await promptHidden("Confirm: ");
  if (password !== again) throw new Error("Passwords did not match.");

  const passHash = await hash(password, ARGON2);
  const pool = new Pool({ connectionString: url, max: 1 });

  try {
    const db = drizzle(pool);
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      await db.update(users).set({ passHash }).where(eq(users.id, existing.id));
      console.log(`updated password for ${email}`);
      return;
    }

    // Single-owner product: refuse to create a second account.
    const totals = await db.select({ total: count() }).from(users);
    if ((totals[0]?.total ?? 0) > 0) {
      throw new Error(
        "An owner already exists with a different email. This panel is single-owner;\n" +
          "update that account instead, or remove the row from `users` first.",
      );
    }

    await db.insert(users).values({ email, passHash });
    console.log(`created owner ${email}`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
