import "server-only";
import { readFile, stat } from "node:fs/promises";
import { logger } from "@/server/lib/logger";
import { join } from "node:path";
import { trimGuide } from "./guide-trim";

/**
 * LHOS's own operator guide (observe → act → verify, OCR-first, rdp_type for
 * all text in RDP, pace, secrets, failure protocol), layered into the panel
 * agent's system prompt *below* the panel's base rules, which stay
 * authoritative where they differ.
 *
 * Read at runtime from `LHOS_AGENT_GUIDE_PATH`, else `config/agent-guide.md`
 * (scripts/deploy-host.sh copies the LHOS repo's docs/SYSTEM_PROMPT.md there on
 * every deploy, so there is one source of truth). Re-read only when its mtime
 * changes; stable between runs, so it sits inside the cached prompt prefix.
 * If neither is readable the agent runs on the panel's base rules alone.
 */
let cache: { path: string; mtimeMs: number; text: string } | null = null;

const DEFAULT_GUIDE = join(process.cwd(), "config", "agent-guide.md");

export async function loadAgentGuide(
  path = process.env.LHOS_AGENT_GUIDE_PATH || DEFAULT_GUIDE,
): Promise<{
  text: string;
  source: "file" | "none";
}> {
  if (path) {
    try {
      const info = await stat(path);
      if (cache && cache.path === path && cache.mtimeMs === info.mtimeMs) {
        return { text: cache.text, source: "file" };
      }
      const text = trimGuide(await readFile(path, "utf8"));
      if (text) {
        cache = { path, mtimeMs: info.mtimeMs, text };
        return { text, source: "file" };
      }
    } catch (err) {
      logger.warn("agent", { msg: "agent guide unreadable; running on base rules only", detail: String(err) });
    }
  }
  return { text: "", source: "none" };
}
