import "server-only";
import type {
  CompletionRequest,
  ModelAdapter,
  StreamEvent,
  TokenUsage,
} from "../types";
import { estimateTokens } from "../pricing";

/**
 * Development adapter — no network, no key (IMPLEMENTATION_PLAN §8).
 *
 * It exists so the agent loop, SSE stream, step persistence, approval
 * checkpoints and the usage ticker can all be built and verified end to end
 * before a vendor key is entered. It is a *test double for the model*, not a
 * fake LHOS: tool calls it emits hit the real agent computer.
 *
 * Behaviour is driven by the last user message so tests can steer it:
 *   "/tool <name> {json}"  → emit that tool call
 *   "/error"               → emit a refusal stop
 *   anything else          → stream a short acknowledgement
 *
 * After observing a tool result it finishes with a summary instead of calling
 * another tool, so a loop bug shows up as a hang rather than an endless run.
 */
const CHUNK = 12;
const DELAY_MS = 15;

export class MockAdapter implements ModelAdapter {
  readonly vendor = "mock";

  async *stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    const last = lastUserText(request);
    const sawToolResult = request.messages.some((m) =>
      m.content.some((p) => p.type === "tool_result"),
    );

    if (last.startsWith("/error")) {
      yield { type: "usage", usage: usageFor(request, "") };
      yield { type: "stop", reason: "refusal" };
      return;
    }

    const directive = parseToolDirective(last);
    if (directive && !sawToolResult && request.tools.length > 0) {
      const text = `Calling \`${directive.name}\` on the agent computer.`;
      if (yield* emitText(text, request.signal)) {
        yield { type: "stop", reason: "aborted" };
        return;
      }
      yield {
        type: "tool_call",
        id: `mock_${Date.now().toString(36)}`,
        name: directive.name,
        args: directive.args,
      };
      yield { type: "usage", usage: usageFor(request, text) };
      yield { type: "stop", reason: "tool_use" };
      return;
    }

    const reply = sawToolResult
      ? "Done — the tool came back and I have recorded the result."
      : `Mock model here. You said: "${truncate(last, 160)}". No vendor key is set, so this is a canned reply.`;

    if (yield* emitText(reply, request.signal)) {
      yield { type: "stop", reason: "aborted" };
      return;
    }
    yield { type: "usage", usage: usageFor(request, reply) };
    yield { type: "stop", reason: "end" };
  }
}

/**
 * Streams text chunks and **returns** whether it was aborted, rather than
 * yielding the stop event itself — the caller owns the single terminal `stop`
 * every adapter must emit exactly once.
 */
async function* emitText(
  text: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, boolean> {
  for (let i = 0; i < text.length; i += CHUNK) {
    if (signal?.aborted) return true;
    yield { type: "text", text: text.slice(i, i + CHUNK) };
    await sleep(DELAY_MS);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastUserText(request: CompletionRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i -= 1) {
    const message = request.messages[i];
    if (message?.role !== "user") continue;
    const text = message.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

function parseToolDirective(
  text: string,
): { name: string; args: Record<string, unknown> } | null {
  const match = /^\/tool\s+([a-z0-9_]+)\s*(\{[\s\S]*\})?\s*$/i.exec(text.trim());
  if (!match?.[1]) return null;

  let args: Record<string, unknown> = {};
  if (match[2]) {
    try {
      const parsed: unknown = JSON.parse(match[2]);
      if (parsed && typeof parsed === "object") {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      // A malformed directive still produces a tool call, so the loop's own
      // argument validation is what gets exercised.
    }
  }

  return { name: match[1], args };
}

function usageFor(request: CompletionRequest, output: string): TokenUsage {
  const input =
    estimateTokens(request.system) +
    request.messages.reduce(
      (sum, m) =>
        sum +
        m.content.reduce(
          (inner, p) => inner + estimateTokens(JSON.stringify(p)),
          0,
        ),
      0,
    );

  return { in: input, out: estimateTokens(output), cached: 0 };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
