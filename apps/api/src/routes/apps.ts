import type { Hono } from 'hono';
import { lookup } from 'node:dns/promises';
import { z } from 'zod';
import { ConnectRequest } from '@superagent/contracts';
import { composioUserIdFor, createPendingConnection, getConnectionForOwner, listConnections, updateConnection } from '@superagent/db';
import { isPrivateAddress } from '@superagent/policy';
import type { Toolkit } from '@superagent/connectors';
import type { ApiDeps, AppEnvVars, RouteHelpers } from '../app';
import { ComposioClient } from '../composio/client';
import { buildSections, findToolkit, queryCatalog } from '../composio/catalog';
import { getCatalog, getToolkitDetail, supportedToolkits } from '../composio/tools';

const SUPPORTED_ENUM = new Set(ConnectRequest.shape.toolkit.options as readonly string[]);

const CatalogQuery = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(48),
  refresh: z.enum(['1']).optional(),
  view: z.enum(['sections']).optional(),
  slugs: z.string().trim().max(2000).optional(),
});

const ComposioAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('connect'), toolkit: z.string().trim().min(1).max(64), credentials: z.record(z.string(), z.string()).optional() }),
  z.object({ action: z.literal('disconnect'), accountId: z.uuid() }),
  z.object({ action: z.literal('setKey'), key: z.string() }),
  z.object({ action: z.literal('clearKey') }),
]);

const STATUS: Record<string, string> = { active: 'ACTIVE', initiated: 'PENDING', expired: 'EXPIRED', revoked: 'EXPIRED', failed: 'FAILED', disconnected: 'INACTIVE' };

/**
 * Connect Apps over main's Composio model. The catalog (all Composio apps) is browsable; an app
 * can be connected only when the agent has verified tools for it, through the same per-user,
 * ownership-verified Connect Link flow as /api/connections. Keys live on the server only.
 */
export function registerAppRoutes(app: Hono<AppEnvVars>, d: ApiDeps, h: RouteHelpers) {
  const { uid } = h;
  const client = () => (d.env.COMPOSIO_API_KEY ? new ComposioClient(d.env.COMPOSIO_API_KEY) : null);
  const notConfigured = () => ({ error: 'setup_required', message: 'Composio is not configured on this server (COMPOSIO_API_KEY).' });

  app.get('/api/connectors/composio', async (c) => {
    if (!d.env.COMPOSIO_API_KEY) return c.json({ configured: false });
    const conns = await listConnections(d.db, uid(c));
    return c.json({
      configured: true,
      source: 'env',
      last4: null,
      accounts: conns
        .filter((x) => x.status !== 'disconnected')
        .map((x) => ({ id: x.id, toolkit: x.toolkit, status: STATUS[x.status] ?? 'PENDING', reason: x.status === 'failed' ? 'connection failed' : null, scheme: 'OAUTH2', createdAt: x.createdAt.toISOString() })),
      mcp: null,
      triggers: 0,
      error: null,
    });
  });

  app.post('/api/connectors/composio', async (c) => {
    const ownerId = uid(c);
    const req = ComposioAction.parse(await c.req.json().catch(() => ({})));
    if (req.action === 'setKey' || req.action === 'clearKey') {
      return c.json({ error: 'forbidden', message: 'The Composio key is managed on the server (COMPOSIO_API_KEY), not per user.' }, 403);
    }
    if (!d.env.COMPOSIO_API_KEY) return c.json(notConfigured(), 503);
    if (req.action === 'disconnect') {
      const conn = await getConnectionForOwner(d.db, ownerId, req.accountId);
      if (conn.composioConnectedAccountId && conn.status !== 'disconnected') await d.connections().disconnect(conn.composioConnectedAccountId);
      await updateConnection(d.db, ownerId, conn.id, { status: 'disconnected' });
      return c.json({ ok: true });
    }
    const toolkit = req.toolkit.toLowerCase();
    if (!SUPPORTED_ENUM.has(toolkit) || !supportedToolkits().has(toolkit)) {
      return c.json({
        kind: 'unsupported',
        reason: `The agent has no verified tools for ${req.toolkit} yet, so connecting it would not let the agent use it. Supported now: ${[...supportedToolkits()].join(', ')}.`,
        guideUrl: null,
      });
    }
    const row = await createPendingConnection(d.db, ownerId, toolkit, null);
    const callbackUrl = `${d.env.WEB_ORIGIN}/api/connections/callback?cid=${row.id}`;
    try {
      const r = await d.connections().initiate(composioUserIdFor(ownerId), toolkit as Toolkit, callbackUrl);
      await updateConnection(d.db, ownerId, row.id, { composioConnectedAccountId: r.connectedAccountId });
      return c.json({ kind: 'redirect', redirectUrl: r.redirectUrl, accountId: row.id });
    } catch (err) {
      await updateConnection(d.db, ownerId, row.id, { status: 'failed' });
      throw err;
    }
  });

  app.get('/api/connectors/composio/catalog', async (c) => {
    const cl = client();
    if (!cl) return c.json(notConfigured(), 503);
    const q = CatalogQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams));
    const all = await getCatalog(cl, q.refresh === '1');
    const meta = { facets: all.facets, categories: all.categories, catalogSize: all.toolkits.length, upstreamTotal: all.upstreamTotal };
    c.header('Cache-Control', 'private, max-age=60');
    if (q.view === 'sections') return c.json({ ...buildSections(all.toolkits), ...meta });
    const slugs = q.slugs ? q.slugs.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100) : undefined;
    const { items, total } = queryCatalog(all.toolkits, { search: q.q, category: q.category, slugs, offset: q.offset, limit: q.limit });
    return c.json({ items, total, offset: q.offset, ...meta });
  });

  app.get('/api/connectors/composio/toolkit', async (c) => {
    const cl = client();
    if (!cl) return c.json(notConfigured(), 503);
    const slug = z.string().trim().regex(/^[a-z0-9_-]{1,64}$/i).parse(c.req.query('slug'));
    const detail = await getToolkitDetail(cl, slug);
    if (!detail) return c.json({ error: 'not_found', message: `No Composio app "${slug}".` }, 404);
    return c.json(detail);
  });

  app.get('/api/connectors/composio/installed', async (c) => {
    const cl = client();
    const conns = (await listConnections(d.db, uid(c))).filter((x) => x.status !== 'disconnected');
    const catalog = cl ? await getCatalog(cl).catch(() => null) : null;
    const byToolkit = new Map<string, typeof conns>();
    for (const x of conns) byToolkit.set(x.toolkit, [...(byToolkit.get(x.toolkit) ?? []), x]);
    return c.json({
      apps: [...byToolkit.entries()].map(([toolkit, rows]) => {
        const tk = catalog ? findToolkit(catalog.toolkits, toolkit) : undefined;
        const best = rows.find((r) => r.status === 'active') ?? rows[0]!;
        return {
          toolkit,
          status: STATUS[best.status] === 'ACTIVE' ? 'ACTIVE' : STATUS[best.status] === 'EXPIRED' ? 'EXPIRED' : 'PENDING',
          accountId: best.id,
          accounts: rows.map((r) => ({ id: r.id, status: STATUS[r.status] ?? 'PENDING', createdAt: r.createdAt.toISOString() })),
          createdAt: best.createdAt.toISOString(),
          name: tk?.name ?? toolkit,
          description: tk?.description ?? '',
          toolsCount: tk?.toolsCount ?? 0,
          enabledCount: 0,
        };
      }),
    });
  });

  /**
   * Same-origin logo proxy (the web CSP allows images from 'self' only). The URL is never taken
   * from the request: only the slug, resolved through the cached catalog, then checked to be
   * HTTPS on a public address before it is fetched.
   */
  app.get('/api/connectors/composio/logo', async (c) => {
    const cl = client();
    if (!cl) return c.body(null, 404);
    const slug = c.req.query('slug') ?? '';
    if (!/^[a-z0-9_-]{1,64}$/i.test(slug)) return c.body(null, 404);
    const tk = findToolkit((await getCatalog(cl)).toolkits, slug);
    if (!tk?.logo) return c.body(null, 404);
    let url: URL;
    try {
      url = new URL(tk.logo);
    } catch {
      return c.body(null, 404);
    }
    if (url.protocol !== 'https:') return c.body(null, 404);
    const addrs = await lookup(url.hostname, { all: true }).catch(() => []);
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return c.body(null, 404);
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000), redirect: 'error' }).catch(() => null);
    const type = res?.headers.get('content-type') ?? '';
    if (!res?.ok || !type.startsWith('image/')) return c.body(null, 404);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 256 * 1024) return c.body(null, 404);
    return new Response(buf, {
      headers: { 'content-type': type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" },
    });
  });

  /** Per-tool enable/disable is application policy here (curated, verified tools), not a user setting. */
  app.put('/api/connectors/composio/tools', (c) =>
    c.json({ error: 'forbidden', message: 'Which app tools the agent may use is decided by the application (verified tools only).' }, 403),
  );
}
