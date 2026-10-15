import "server-only";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { readSseData } from "./sse";
import { vendorError } from "./anthropic";
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
 * Chat Completions-shaped vendors — OpenAI and OpenRouter share one adapter
 * because OpenRouter is wire-compatible; only the base URL, key and a couple of
 * attribution headers differ.
 *
 * Two shape differences from Anthropic drive this code:
 *  - tool results are their own `role: "tool"` messages, not parts of a user turn
 *  - `usage` is absent from a stream unless `stream_options.include_usage` is set
 */
export class OpenAiCompatibleAdapter implements ModelAdapter {
  constructor(
    readonly vendor: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  async *stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model: request.model,
        max_completion_tokens: request.maxTokens,
        messages: [
          { role: "system", content: request.system },
          ...request.messages.flatMap(toOpenAiMessages),
        ],
        ...(request.tools.length > 0
          ? {
              tools: request.tools.map((t) => ({
                type: "function",
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.inputSchema,
                },
              })),
            }
          : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        stream: true,
        stream_options: { include_usage: true },
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });

    if (!response.ok || !response.body) {
      throw await vendorError(this.vendor, response);
    }

    const usage: TokenUsage = { in: 0, out: 0, cached: 0 };
    let stopReason: StopReason = "end";

    /** Tool calls accumulate by their position in the delta array. */
    const pending = new Map<number, { id: string; name: string; args: string }>();

    for await (const frame of readSseData(response.body)) {
      if (request.signal?.aborted) {
        yield { type: "stop", reason: "aborted" };
        return;
      }
      if (frame.data === "[DONE]") break;

      const event = parseJson(frame.data);
      if (!event) continue;

      if (event.error?.message) {
        throw new AppError("vendor_error", `${this.vendor}: ${event.error.message}`);
      }

      if (event.usage) {
        Object.assign(usage, readUsage(event.usage));
      }

      const choice = event.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;
      if (typeof delta?.content === "string" && delta.content) {
        yield { type: "text", text: delta.content };
      }

      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const partial = pending.get(index) ?? { id: "", name: "", args: "" };
        if (call.id) partial.id = call.id;
        if (call.function?.name) partial.name = call.function.name;
        if (call.function?.arguments) partial.args += call.function.arguments;
        pending.set(index, partial);
      }

      if (choice.finish_reason) {
        stopReason = mapStopReason(choice.finish_reason);
      }
    }

    // Unlike Anthropic there is no per-block stop event, so completed tool calls
    // are emitted once the stream ends.
    for (const partial of pending.values()) {
      if (!partial.name) continue;
      yield {
        type: "tool_call",
        id: partial.id || `call_${partial.name}`,
        name: partial.name,
        args: parseArgs(partial.args, partial.name, this.vendor),
      };
    }

    yield { type: "usage", usage };
    yield { type: "stop", reason: stopReason };
  }
}

/** One adapter message can become several: tool results are separate turns. */
function toOpenAiMessages(message: AdapterMessage): unknown[] {
  const results = message.content.filter((p) => p.type === "tool_result");
  const toolUses = message.content.filter((p) => p.type === "tool_use");
  const rest = message.content.filter(
    (p) => p.type === "text" || p.type === "image",
  );

  const out: unknown[] = [];

  if (rest.length > 0 || toolUses.length > 0) {
    out.push({
      role: message.role,
      content: rest.length > 0 ? rest.map(toOpenAiPart) : null,
      ...(toolUses.length > 0
        ? {
            tool_calls: toolUses.map((p) => ({
              id: p.type === "tool_use" ? p.id : "",
              type: "function",
              function: {
                name: p.type === "tool_use" ? p.name : "",
                arguments: JSON.stringify(p.type === "tool_use" ? p.args : {}),
              },
            })),
          }
        : {}),
    });
  }

  for (const part of results) {
    if (part.type !== "tool_result") continue;
    // Chat Completions tool messages are text-only; images from a tool result
    // are re-attached as a following user turn so vision still works.
    out.push({ role: "tool", tool_call_id: part.toolUseId, content: part.text });
    if (part.images.length > 0) {
      out.push({
        role: "user",
        content: part.images.map((img) => ({
          type: "image_url",
          image_url: { url: `data:${img.mime};base64,${img.data_b64}` },
        })),
      });
    }
  }

  return out;
}

function toOpenAiPart(part: AdapterPart): unknown {
  if (part.type === "image") {
    return {
      type: "image_url",
      image_url: { url: `data:${part.mime};base64,${part.data_b64}` },
    };
  }
  return { type: "text", text: part.type === "text" ? part.text : "" };
}

function readUsage(raw: OpenAiUsage): TokenUsage {
  return {
    in: raw.prompt_tokens ?? 0,
    out: raw.completion_tokens ?? 0,
    cached: raw.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

function mapStopReason(reason: string): StopReason {
  switch (reason) {
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return "end";
  }
}

function parseArgs(
  json: string,
  toolName: string,
  vendor: string,
): Record<string, unknown> {
  const trimmed = json.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    logger.warn(vendor, { msg: "unparsable tool arguments", tool: toolName });
  }
  return {};
}

function parseJson(data: string): OpenAiStreamEvent | null {
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === "object" ? (parsed as OpenAiStreamEvent) : null;
  } catch {
    return null;
  }
}

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface OpenAiStreamEvent {
  error?: { message?: string };
  usage?: OpenAiUsage;
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}
