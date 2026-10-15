/**
 * Vendor-neutral model interface. Everything above this file (the agent loop,
 * metering, the UI) is written against these types only, so adding a vendor is
 * one new adapter and a `config/models.json` entry.
 */

/**
 * Message content in *resolved* form: images carry bytes, not file ids.
 *
 * The database and the UI reference images by `fileId` (ADR-07) to keep chat
 * state and SSE frames small. The loop resolves those to base64 immediately
 * before calling an adapter, because vendor APIs need the actual bytes.
 */
export type AdapterPart =
  | { type: "text"; text: string }
  | { type: "image"; mime: string; data_b64: string }
  | { type: "tool_use"; id: string; name: string; args: Record<string, unknown> }
  | {
      type: "tool_result";
      toolUseId: string;
      ok: boolean;
      text: string;
      images: Array<{ mime: string; data_b64: string }>;
    };

export interface AdapterMessage {
  role: "user" | "assistant";
  content: AdapterPart[];
}

/** A tool as the model sees it: LHOS name + its JSON Schema, unmodified. */
export interface AdapterTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CompletionRequest {
  /** Vendor-native model id, e.g. `claude-sonnet-5-5` — not the catalogue id. */
  model: string;
  system: string;
  messages: AdapterMessage[];
  tools: AdapterTool[];
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface TokenUsage {
  in: number;
  out: number;
  /** Cache *reads*, billed at the cached rate. */
  cached: number;
}

/**
 * Normalised stream events. `usage` arrives at stream end for every vendor, so
 * the ticker shows a `~` estimate until it lands (skill-token-metering).
 */
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "usage"; usage: TokenUsage }
  | { type: "stop"; reason: StopReason };

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "aborted";

export interface ModelAdapter {
  readonly vendor: string;
  /**
   * Streams one completion. Must emit exactly one `stop` last, and a `usage`
   * event before it whenever the vendor reports token counts.
   */
  stream(request: CompletionRequest): AsyncIterable<StreamEvent>;
}
