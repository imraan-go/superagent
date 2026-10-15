import { createGateway } from '@ai-sdk/gateway';
import { generateText, tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import type { ToolSpec } from '@superagent/policy';
import { priceTimes, usdToNanos } from '@superagent/observability';
import type { CatalogEntry } from './catalog';

export interface DecisionRequest {
  modelId: string;
  system: string;
  /** Dynamic context (memories, task facts) kept separate so the stable system prefix stays cacheable. */
  context: string;
  messages: ModelMessage[];
  tools: ToolSpec[];
  maxOutputTokens: number;
  endUserId?: string;
  abortSignal?: AbortSignal;
}

export interface ProposedCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
  valid: boolean;
  error?: string;
}

export interface DecisionUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costNanos: bigint | null;
  costStatus: 'measured' | 'estimated' | 'unknown';
  generationId: string | null;
  requestId: string | null;
  resolvedProvider: string | null;
  providerAttempts: number | null;
  responseModelId: string | null;
}

export interface DecisionOutput {
  finishReason: string;
  text: string;
  calls: ProposedCall[];
  responseMessages: ModelMessage[];
  usage: DecisionUsage;
}

export class PartialOutputError extends Error {
  constructor(
    message: string,
    public readonly usage: DecisionUsage,
  ) {
    super(message);
    this.name = 'PartialOutputError';
  }
}

const ALLOWED_FINISH = new Set(['stop', 'tool-calls']);

export interface ProviderOptions {
  apiKey: string;
  providerOnly?: string[];
  reportingTags?: boolean;
  fetch?: typeof fetch;
  /** Test seam only: substitutes the Gateway model (production always uses the Gateway). */
  languageModel?: (modelId: string) => LanguageModel;
}

/**
 * All product model calls go through Vercel AI Gateway. Tools are declared WITHOUT `execute`, so the
 * SDK returns typed proposals and never runs anything itself; execution happens only through the
 * app's policy broker in separate Temporal Activities.
 */
export class VercelGatewayModelProvider {
  private readonly gateway;

  constructor(private readonly opts: ProviderOptions) {
    this.gateway = createGateway({ apiKey: opts.apiKey, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  }

  async credits() {
    return this.gateway.getCredits();
  }

  async decide(req: DecisionRequest): Promise<DecisionOutput> {
    const tools: ToolSet = {};
    for (const spec of req.tools) tools[spec.name] = tool({ description: spec.description, inputSchema: spec.schema });

    const gatewayOptions: Record<string, unknown> = { caching: 'auto' };
    if (this.opts.providerOnly?.length) gatewayOptions.only = this.opts.providerOnly;
    // Reporting tags/user attribution carry a per-request Gateway surcharge; opt-in only.
    if (this.opts.reportingTags) {
      gatewayOptions.tags = ['superagent'];
      if (req.endUserId) gatewayOptions.user = req.endUserId;
    }

    const result = await generateText({
      model: this.opts.languageModel ? this.opts.languageModel(req.modelId) : this.gateway(req.modelId),
      instructions: [
        { role: 'system', content: req.system, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
        { role: 'system', content: req.context },
      ],
      messages: req.messages,
      tools,
      toolChoice: 'auto',
      maxOutputTokens: req.maxOutputTokens,
      maxRetries: 0,
      abortSignal: req.abortSignal,
      providerOptions: { gateway: gatewayOptions as never },
    });

    const usage = extractUsage(result);
    if (!ALLOWED_FINISH.has(result.finishReason)) {
      throw new PartialOutputError(`model finished with "${result.finishReason}"; output treated as incomplete`, usage);
    }
    const byName = new Map(req.tools.map((t) => [t.name, t]));
    const calls: ProposedCall[] = result.toolCalls.map((c) => {
      const spec = byName.get(c.toolName);
      const invalid = (c as { invalid?: boolean }).invalid === true || (c as { dynamic?: boolean }).dynamic === true;
      if (!spec) return { toolCallId: c.toolCallId, toolName: c.toolName, input: c.input, valid: false, error: 'unknown tool' };
      const parsed = spec.schema.safeParse(c.input);
      if (invalid || !parsed.success) {
        return { toolCallId: c.toolCallId, toolName: c.toolName, input: c.input, valid: false, error: parsed.success ? 'invalid tool call' : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
      }
      return { toolCallId: c.toolCallId, toolName: c.toolName, input: parsed.data, valid: true };
    });
    if (result.finishReason === 'tool-calls' && calls.length === 0) {
      throw new PartialOutputError('finish reason was tool-calls but no tool calls were returned', usage);
    }
    return { finishReason: result.finishReason, text: result.text, calls, responseMessages: result.response.messages as ModelMessage[], usage };
  }
}

type GenResult = Awaited<ReturnType<typeof generateText>>;

export function extractUsage(result: Pick<GenResult, 'usage' | 'providerMetadata' | 'response'>): DecisionUsage {
  const gw = (result.providerMetadata?.gateway ?? {}) as Record<string, unknown>;
  const routing = (gw.routing ?? {}) as Record<string, unknown>;
  const attempts = (routing.modelAttempts as Array<{ providerAttempts?: Array<{ providerRequestId?: string }> }> | undefined) ?? [];
  const lastProviderAttempt = attempts.at(-1)?.providerAttempts?.at(-1);
  const totalCost = typeof gw.gatewayCost === 'string' ? gw.gatewayCost : typeof gw.cost === 'string' ? gw.cost : undefined;
  let costNanos: bigint | null;
  try {
    costNanos = totalCost !== undefined ? usdToNanos(totalCost) : null;
  } catch {
    costNanos = null;
  }
  const u = result.usage;
  return {
    inputTokens: u?.inputTokens ?? null,
    outputTokens: u?.outputTokens ?? null,
    cacheReadTokens: u?.inputTokenDetails?.cacheReadTokens ?? null,
    cacheWriteTokens: u?.inputTokenDetails?.cacheWriteTokens ?? null,
    costNanos,
    costStatus: costNanos !== null ? 'measured' : 'unknown',
    generationId: typeof gw.generationId === 'string' ? gw.generationId : null,
    requestId: lastProviderAttempt?.providerRequestId ?? result.response?.id ?? null,
    resolvedProvider: typeof routing.finalProvider === 'string' ? routing.finalProvider : null,
    providerAttempts: typeof routing.totalProviderAttemptCount === 'number' ? routing.totalProviderAttemptCount : null,
    responseModelId: result.response?.modelId ?? null,
  };
}

/**
 * Upper-bound estimate for budget reservation: all input at the uncached input rate plus the full
 * output allowance. Not a vendor invoice ceiling.
 */
export function estimateMaxCostNanos(entry: CatalogEntry, approxInputTokens: number, maxOutputTokens: number, perRequestSurchargeUsd = '0'): bigint {
  if (!entry.pricing) throw new Error(`no pricing for ${entry.id}`);
  return priceTimes(entry.pricing.input, approxInputTokens) + priceTimes(entry.pricing.output, maxOutputTokens) + usdToNanos(perRequestSurchargeUsd);
}

/** Cheap, conservative token estimate (~3 chars/token) for reservation sizing only. */
export function approxTokens(...parts: unknown[]): number {
  let chars = 0;
  for (const p of parts) chars += typeof p === 'string' ? p.length : JSON.stringify(p ?? '').length;
  return Math.ceil(chars / 3) + 500;
}
