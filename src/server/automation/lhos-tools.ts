import "server-only";
import { lhos, resultText } from "@/server/lhos/client";
import { AppError } from "@/server/lib/errors";

/**
 * Calls an LHOS tool on the owner's behalf (not the agent's) and returns its
 * text output. Automation tools answer with JSON encoded in a text block.
 */
export async function callLhosText(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = await lhos.callTool(name, args, { timeoutMs: 30_000 });
  const text = resultText(res.result);
  if (!res.ok) throw new AppError("tool_failed", text || `${name} failed.`);
  return text;
}

export async function callLhosJson<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T | null> {
  const text = await callLhosText(name, args);
  try {
    return JSON.parse(text) as T;
  } catch {
    // e.g. "(no connectors defined)" — a human sentence meaning "empty".
    return null;
  }
}
