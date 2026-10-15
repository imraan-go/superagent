import "server-only";
import { readFile, stat } from "node:fs/promises";
import { logger } from "@/server/lib/logger";
import { EMBEDDED_AGENT_GUIDE } from "./guide-fallback";
import { trimGuide } from "./guide-trim";

/**
 * LHOS's own operator guide (observe → act → verify, OCR-first, rdp_type for
 * all text in RDP, pace, secrets, failure protocol), layered into the panel
 * agent's system prompt *below* the panel's base rules, which stay
 * authoritative where they differ.
 *
 * Read at runtime from `LHOS_AGENT_GUIDE_PATH` (re-read only when its mtime
 * changes), with an embedded copy as fallback. The result is stable between
 * runs, so it sits inside the cached system-prompt prefix.
 */
let cache: { path: string; mtimeMs: number; text: string } | null = null;

export async function loadAgentGuide(path = process.env.LHOS_AGENT_GUIDE_PATH): Promise<{
  text: string;
  source: "file" | "embedded";
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
      logger.debug("agent", { msg: "agent guide unreadable, using embedded copy", detail: String(err) });
    }
  }
  return { text: embedded(), source: "embedded" };
}

let embeddedText: string | null = null;
function embedded(): string {
  return (embeddedText ??= trimGuide(EMBEDDED_AGENT_GUIDE));
}
