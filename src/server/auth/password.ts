import "server-only";
import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id parameters. Chosen for a single-owner login on a 15 GB host that is
 * also running the agent stack: 19 MiB / 2 passes is the OWASP baseline and
 * costs ~50 ms here, which is plenty against a rate-limited endpoint.
 *
 * `@node-rs` rather than the `argon2` npm package: prebuilt binaries, so the
 * Docker build needs no node-gyp toolchain.
 */
const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/** Never throws on a malformed stored hash — returns false. */
export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain, OPTIONS);
  } catch {
    return false;
  }
}
