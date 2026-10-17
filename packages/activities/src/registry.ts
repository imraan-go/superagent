import { APP_TOOLS, type ConnectorToolSpec, type ToolSpec } from '@superagent/policy';
import type { Deps } from './deps';

export type AnyToolSpec = ToolSpec | ConnectorToolSpec;

export function toolRegistry(d: Pick<Deps, 'connectorTools'>): Map<string, AnyToolSpec> {
  const m = new Map<string, AnyToolSpec>();
  for (const t of Object.values(APP_TOOLS)) m.set(t.name, t as ToolSpec);
  for (const t of d.connectorTools()) m.set(t.name, t);
  return m;
}

export function isConnectorSpec(s: AnyToolSpec): s is ConnectorToolSpec {
  return s.executor === 'connector';
}

/** Tools offered to the model for this task: only what is configured, connected and permitted. */
/**
 * The composer chip a tool belongs to. Tools without one (ask_user, routines) are always offered:
 * chips choose what the agent may *use*, never whether it can talk to the user.
 */
export function capabilityOfTool(t: AnyToolSpec): 'computer' | 'browser' | 'connectors' | 'memory' | null {
  if (t.executor === 'workspace') return 'computer';
  if (t.executor === 'browser') return 'browser';
  if (t.executor === 'connector') return 'connectors';
  if (t.name === 'memory_save') return 'memory';
  return null;
}

export function exposedTools(
  reg: Map<string, AnyToolSpec>,
  opts: { configured: Set<string>; activeToolkits: Set<string>; readOnly: boolean; allowedDomains: string[]; scheduled?: boolean; capabilities?: string[] | null },
): AnyToolSpec[] {
  const chips = opts.capabilities?.length ? new Set(opts.capabilities) : null;
  return [...reg.values()].filter((t) => {
    if (opts.scheduled && (t as ToolSpec).interactiveOnly) return false;
    const cap = capabilityOfTool(t);
    if (chips && cap && !chips.has(cap)) return false;
    if (!t.requires.every((r) => opts.configured.has(r))) return false;
    if (t.executor === 'connector' && (!t.toolkit || !opts.activeToolkits.has(t.toolkit))) return false;
    if (t.executor === 'browser' && opts.allowedDomains.length === 0) return false;
    if (t.classification === 'blocked') return false;
    if (opts.readOnly && t.classification === 'external_write') return false;
    return true;
  });
}
