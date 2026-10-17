/**
 * `pnpm models:verify` — validates the configured Gateway models against the live catalogue
 * (existence, allowlist, tool use, vision for the browser model, published pricing). Free: it reads
 * the public catalogue and makes no generation call.
 */
import { getEnv, modelAllowlist } from '@superagent/config';
import { checkModel, fetchGatewayCatalog, type Capability } from '@superagent/agent';

const env = getEnv();
const catalog = await fetchGatewayCatalog();
const allow = modelAllowlist(env);
const roles: Array<[string, string | undefined, Capability[]]> = [
  ['primary', env.AI_MODEL_PRIMARY, ['tool-use']],
  ['browser', env.AI_MODEL_BROWSER, ['tool-use', 'vision']],
];

let failed = 0;
for (const [role, id, req] of roles) {
  const c = checkModel(catalog, id, allow, req);
  const entry = id ? catalog.get(id) : undefined;
  const price = entry?.pricing
    ? `in $${entry.pricing.input}/tok, out $${entry.pricing.output}/tok${entry.pricing.input_cache_read ? `, cache read $${entry.pricing.input_cache_read}/tok` : ''}`
    : 'no pricing';
  if (c.ok) console.log(`OK    ${role.padEnd(8)} ${c.modelId}  (${price}; context ${entry?.context_window ?? '?'})`);
  else {
    failed++;
    console.log(`FAIL  ${role.padEnd(8)} ${c.modelId ?? '(unset)'}  ${c.problems.join(', ')}`);
  }
}
for (const id of allow) if (!catalog.has(id)) console.log(`WARN  allowlist entry ${id} is not in the live catalogue`);
console.log(`\n${catalog.size} models in the live catalogue.`);
process.exit(failed ? 1 : 0);
