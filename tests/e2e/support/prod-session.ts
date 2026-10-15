import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sealData } from "iron-session";
import pg from "pg";

/**
 * Production smoke only: mints an owner session cookie in-process from the
 * single `users` row, sealed with PANEL_SECRET_KEY exactly as the app does.
 * Nothing here is printed — the e-mail and secret stay in memory.
 */
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let text = "";
  try {
    text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return { ...process.env } as Record<string, string>;
  }
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2] ?? "";
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]!] = v;
  }
  return { ...out, ...(process.env as Record<string, string>) };
}

export const prodEnv = loadEnv();

export async function mintOwnerCookie(host: string) {
  return withDb(async (client) => {
    const { rows } = await client.query("select id, email from users limit 2");
    if (rows.length !== 1) throw new Error(`expected exactly one owner row, got ${rows.length}`);
    const value = await sealData(
      { userId: rows[0].id, email: rows[0].email, loggedInAt: Math.floor(Date.now() / 1000) },
      { password: prodEnv.PANEL_SECRET_KEY ?? "", ttl: 60 * 60 * 24 * 30 },
    );
    return {
      name: "fd_session",
      value,
      domain: host,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    };
  });
}

/** Direct DB access for assertions the API does not expose. */
export async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: prodEnv.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
