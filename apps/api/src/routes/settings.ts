import type { Hono } from 'hono';
import { isSection, mergeSection, parseStored, validateSection } from '@superagent/contracts';
import { capabilityStatus } from '@superagent/config';
import { getPreference, listConnections, setPreference } from '@superagent/db';
import { APP_TOOLS, verifiedConnectorTools, type ToolSpec } from '@superagent/policy';
import type { ApiDeps, AppEnvVars, RouteHelpers } from '../app';

/** Preference sections (appearance, sound, …). Budgets and tool policy have their own routes. */
export function registerSettingsRoutes(app: Hono<AppEnvVars>, d: ApiDeps, h: RouteHelpers) {
  const { uid } = h;

  /**
   * What the agent can do on this installation, for the owner's information. Read-only: policy is
   * application-owned (external writes always need exact approval; routines always confirm).
   */
  app.get('/api/tools', async (c) => {
    const caps = capabilityStatus(d.env);
    const configured = new Set(
      Object.entries(caps)
        .filter(([, v]) => v.configured)
        .map(([k]) => k),
    );
    const active = new Set(
      (await listConnections(d.db, uid(c))).filter((x) => x.status === 'active').map((x) => x.toolkit),
    );
    const specs: Array<ToolSpec & { toolkit?: string }> = [...Object.values(APP_TOOLS), ...verifiedConnectorTools()];
    return c.json({
      tools: specs.map((t) => ({
        name: t.name,
        description: t.description,
        classification: t.classification,
        executor: t.executor,
        toolkit: t.toolkit ?? null,
        needsApproval: t.classification === 'external_write',
        confirms: t.confirm === true,
        available:
          t.requires.every((r) => configured.has(r)) &&
          (t.executor !== 'connector' || (t.toolkit ? active.has(t.toolkit) : false)),
        missing: t.requires.filter((r) => !configured.has(r)),
      })),
      capabilities: Object.fromEntries(
        Object.entries(caps).map(([k, v]) => [k, { configured: v.configured, missing: v.missing }]),
      ),
    });
  });

  app.get('/api/settings/:section', async (c) => {
    const section = c.req.param('section');
    if (!isSection(section)) return c.json({ error: 'not_found', message: `unknown settings section ${section}` }, 404);
    return c.json(parseStored(section, await getPreference(d.db, uid(c), section)));
  });

  app.put('/api/settings/:section', async (c) => {
    const section = c.req.param('section');
    if (!isSection(section)) return c.json({ error: 'not_found', message: `unknown settings section ${section}` }, 404);
    const patch = await c.req.json().catch(() => ({}));
    if (JSON.stringify(patch).length > 16_000)
      return c.json({ error: 'invalid_request', message: 'settings value too large' }, 400);
    const current = await getPreference(d.db, uid(c), section);
    const next = validateSection(section, mergeSection(parseStored(section, current), patch));
    return c.json(parseStored(section, await setPreference(d.db, uid(c), section, next as Record<string, unknown>)));
  });
}
