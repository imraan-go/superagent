import "server-only";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { readSseData } from "./sse";
import type {
  AdapterMessage,
  AdapterPart,
  CompletionRequest,
  ModelAdapter,
  StopReason,
  StreamEvent,
  TokenUsage,
} from "../types";

/**
 * Anthropic Messages API, streaming (`/v1/messages`, `stream: true`).
 *
 * Tool arguments arrive as a *string* assembled across
 * `input_json_delta` events, so a tool call is only emitted once its block
 * stops — emitting earlier would hand the loop unparsable arguments.
 */
const API_VERSION = "2023-06-01";

export class AnthropicAdapter implements ModelAdapter {
  readonly vendor = "anthropic";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async *stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(buildAnthropicBody(request)),
      ...(request.signal ? { signal: request.signal } : {}),
    });

    if (!response.ok || !response.body) {
      throw await vendorError("anthropic", response);
    }

    const usage: TokenUsage = { in: 0, out: 0, cached: 0 };
    let stopReason: StopReason = "end";

    /** Partial tool blocks, keyed by the stream's content block index. */
    const pending = new Map<number, { id: string; name: string; json: string }>();

    for await (const frame of readSseData(response.body)) {
      if (request.signal?.aborted) {
        yield { type: "stop", reason: "aborted" };
        return;
      }

      const event = parseJson(frame.data);
      if (!event) continue;

      switch (event.type) {
        case "message_start": {
          Object.assign(usage, readUsage(event.message?.usage, usage));
          break;
        }

        case "content_block_start": {
          const block = event.content_block;
          if (block?.type === "tool_use" && typeof event.index === "number") {
            pending.set(event.index, {
              id: String(block.id ?? ""),
              name: String(block.name ?? ""),
              json: "",
            });
          }
          break;
        }

        case "content_block_delta": {
          const delta = event.delta;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            yield { type: "text", text: delta.text };
          } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
            // Summarised reasoning (display: "summarized"). `signature_delta`
            // and redacted_thinking blocks are ignored: thinking is shown,
            // never replayed (see buildAnthropicBody).
            if (delta.thinking) yield { type: "thinking", text: delta.thinking };
          } else if (
            delta?.type === "input_json_delta" &&
            typeof event.index === "number"
          ) {
            const partial = pending.get(event.index);
            if (partial) partial.json += String(delta.partial_json ?? "");
          }
          break;
        }

        case "content_block_stop": {
          if (typeof event.index !== "number") break;
          const partial = pending.get(event.index);
          if (!partial) break;
          pending.delete(event.index);
          yield {
            type: "tool_call",
            id: partial.id,
            name: partial.name,
            args: parseArgs(partial.json, partial.name),
          };
          break;
        }

        case "message_delta": {
          Object.assign(usage, readUsage(event.usage, usage));
          if (event.delta?.stop_reason) {
            stopReason = mapStopReason(String(event.delta.stop_reason));
          }
          break;
        }

        case "error": {
          throw new AppError(
            "vendor_error",
            String(event.error?.message ?? "Anthropic reported a stream error."),
          );
        }

        default:
          break;
      }
    }

    yield { type: "usage", usage };
    yield { type: "stop", reason: stopReason };
  }
}

const EPHEMERAL = { type: "ephemeral" } as const;

/**
 * The request body, without credentials. Pure and exported for tests and the
 * Debug mode's "request params" readout.
 *
 * - Prompt caching: tools render before system, so one breakpoint on the
 *   stable system prefix caches tools + guide; a second on the newest message
 *   block caches the growing conversation for the next step of a long run.
 * - Thinking mode (current models: Opus/Sonnet/Haiku 5.5): `thinking:
 *   {type: "adaptive", display: "summarized"}` + `output_config.effort:
 *   "high"`. `budget_tokens` is rejected (400) on these models, and so is a
 *   non-default temperature, so temperature is dropped while thinking. These
 *   models think adaptively even when `thinking` is omitted (display
 *   defaults to "omitted"); Default mode simply omits the field.
 * - Thinking blocks are not replayed: the loop prunes old screenshots and
 *   trims history, which would invalidate replayed blocks; omitting them is
 *   accepted and is what the panel has always sent.
 */
export function buildAnthropicBody(request: CompletionRequest): Record<string, unknown> {
  const messages = request.messages.map(toAnthropicMessage);
  markLastBlock(messages);

  const system = request.systemParts
    ? [
        { type: "text", text: request.systemParts.stable, cache_control: EPHEMERAL },
        ...(request.systemParts.volatile ? [{ type: "text", text: request.systemParts.volatile }] : []),
      ]
    : request.system;

  return {
    model: request.model,
    max_tokens: request.maxTokens,
    system,
    messages,
    ...(request.tools.length > 0
      ? {
          tools: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema,
          })),
        }
      : {}),
    ...(request.thinking
      ? {
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: "high" },
        }
      : request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
    stream: true,
  };
}

/** Adds a cache breakpoint to the newest content block (text / tool_result / image). */
function markLastBlock(messages: Array<{ role: string; content: unknown[] }>): void {
  const last = messages[messages.length - 1];
  const block = last?.content[last.content.length - 1] as Record<string, unknown> | undefined;
  if (block && ["text", "tool_result", "image"].includes(String(block.type))) {
    block.cache_control = EPHEMERAL;
  }
}

function toAnthropicMessage(message: AdapterMessage) {
  return { role: message.role, content: message.content.flatMap(toAnthropicPart) };
}

function toAnthropicPart(part: AdapterPart): unknown[] {
  switch (part.type) {
    case "text":
      return [{ type: "text", text: part.text }];

    case "image":
      return [
        {
          type: "image",
          source: { type: "base64", media_type: part.mime, data: part.data_b64 },
        },
      ];

    case "tool_use":
      return [{ type: "tool_use", id: part.id, name: part.name, input: part.args }];

    case "tool_result":
      return [
        {
          type: "tool_result",
          tool_use_id: part.toolUseId,
          is_error: !part.ok,
          content: [
            { type: "text", text: part.text },
            ...part.images.map((img) => ({
              type: "image",
              source: { type: "base64", media_type: img.mime, data: img.data_b64 },
            })),
          ],
        },
      ];
  }
}

/** Anthropic sends input tokens once and output tokens cumulatively. */
function readUsage(raw: unknown, current: TokenUsage): Partial<TokenUsage> {
  if (!raw || typeof raw !== "object") return {};
  const u = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);

  // `input_tokens` excludes cache reads and writes; the panel's `in` is the
  // total prompt size, with `cached` (reads) and `cacheWrite` as subsets.
  const reads = num(u.cache_read_input_tokens) || current.cached;
  const writes = num(u.cache_creation_input_tokens) || (current.cacheWrite ?? 0);
  const uncached = num(u.input_tokens);
  const total = uncached + reads + writes;
  return {
    in: uncached || reads || writes ? total : current.in,
    out: num(u.output_tokens) || current.out,
    cached: reads,
    ...(writes ? { cacheWrite: writes } : {}),
  };
}

function mapStopReason(reason: string): StopReason {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "end";
  }
}

function parseJson(data: string): AnthropicStreamEvent | null {
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === "object"
      ? (parsed as AnthropicStreamEvent)
      : null;
  } catch {
    return null;
  }
}

/**
 * A tool block with no arguments streams no deltas at all, which is valid and
 * must not be treated as malformed JSON.
 */
function parseArgs(json: string, toolName: string): Record<string, unknown> {
  const trimmed = json.trim();
  if (!trimmed) return {};

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    logger.warn("anthropic", { msg: "unparsable tool arguments", tool: toolName });
  }
  return {};
}

export async function vendorError(vendor: string, response: Response): Promise<AppError> {
  const body = await response.text().catch(() => "");
  const message = extractVendorMessage(body) ?? response.statusText;

  logger.warn("vendor", { vendor, status: response.status });

  if (response.status === 401 || response.status === 403) {
    return new AppError("vendor_error", `${vendor} rejected the API key.`, {
      detail: { status: response.status },
    });
  }
  if (response.status === 429) {
    return new AppError("rate_limited", `${vendor} is rate limiting this key.`);
  }

  return new AppError("vendor_error", `${vendor}: ${message}`, {
    detail: { status: response.status },
  });
}

function extractVendorMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? null;
  } catch {
    return body.slice(0, 200) || null;
  }
}

/**
 * The subset of the Anthropic stream envelope this adapter reads. Everything is
 * optional because the shape varies per `type`, and unknown event types are
 * ignored rather than rejected — Anthropic adds them without a version bump.
 */
interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  message?: { usage?: unknown };
  usage?: unknown;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  error?: { message?: string };
}
