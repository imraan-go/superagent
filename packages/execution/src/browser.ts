import { lookup } from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sandbox } from 'e2b';
import { checkBrowserUrl, isPrivateAddress } from '@superagent/policy';

const CTL_SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'browser_ctl.py'), 'utf8');
const CTL_PATH = '/tmp/superagent/browser_ctl.py';

export class BrowserPolicyError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'BrowserPolicyError';
  }
}

export type Resolver = (host: string) => Promise<string[]>;
export const dnsResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * Rejects hosts that resolve to private/loopback/link-local/metadata ranges (best effort from the
 * worker's resolver; the sandbox also has E2B egress denyOut for private CIDRs).
 */
export async function assertPublicResolution(host: string, resolve: Resolver = dnsResolver) {
  let addrs: string[];
  try {
    addrs = await resolve(host);
  } catch {
    throw new BrowserPolicyError(`could not resolve ${host}`);
  }
  if (!addrs.length || addrs.some(isPrivateAddress))
    throw new BrowserPolicyError(`${host} resolves to a non-public address`);
}

export async function validateDestination(url: string, allowed: string[], resolve: Resolver = dnsResolver) {
  const c = checkBrowserUrl(url, allowed);
  if (!c.ok) throw new BrowserPolicyError(c.reason);
  await assertPublicResolution(c.url.hostname, resolve);
  return c.url;
}

type CtlRequest =
  | { action: 'navigate'; url: string }
  | { action: 'read' }
  | { action: 'screenshot'; fullPage: boolean }
  | { action: 'click'; element: number }
  | { action: 'type'; element: number; text: string }
  | { action: 'scroll'; direction: 'up' | 'down' }
  | { action: 'download'; url: string }
  | { action: 'blank' };

export interface CtlResult {
  ok: boolean;
  error?: string;
  url?: string;
  title?: string;
  status?: number | null;
  text?: string;
  elements?: Array<{ i: number; tag: string; type: string; label: string; href: string }>;
  path?: string;
  contentType?: string;
  size?: number;
}

export async function ensureController(sbx: Sandbox) {
  await sbx.files.makeDir('/tmp/superagent');
  await sbx.files.write(CTL_PATH, CTL_SOURCE);
}

async function ctl(sbx: Sandbox, req: CtlRequest, allowed: string[], timeoutMs = 60_000): Promise<CtlResult> {
  const payload = Buffer.from(JSON.stringify({ ...req, allowed })).toString('base64');
  const r = await sbx.commands.run(`python3 ${CTL_PATH}`, { envs: { BCTL_REQ: payload }, timeoutMs });
  const line = r.stdout
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('SA_RESULT '));
  if (!line) throw new Error(`browser controller produced no result (exit ${r.exitCode})`);
  return JSON.parse(line.slice('SA_RESULT '.length)) as CtlResult;
}

export async function chromeVersion(sbx: Sandbox): Promise<string> {
  const r = await sbx.commands.run('google-chrome --version', { timeoutMs: 15_000 });
  return r.stdout.trim();
}

/**
 * The mediated browser surface. Every destination is validated before the action, and the
 * resulting URL is re-validated after it (redirects / script navigations); a violation returns the
 * page to about:blank and surfaces a policy error.
 */
export class BrowserBroker {
  constructor(private readonly resolve: Resolver = dnsResolver) {}

  private async postCheck(sbx: Sandbox, res: CtlResult, allowed: string[]) {
    if (res.url && res.url !== 'about:blank') {
      const c = checkBrowserUrl(res.url, allowed);
      const bad = !c.ok
        ? c.reason
        : await assertPublicResolution(c.url.hostname, this.resolve).then(
            () => null,
            (e: Error) => e.message,
          );
      if (bad) {
        await ctl(sbx, { action: 'blank' }, allowed).catch(() => undefined);
        throw new BrowserPolicyError(`navigation ended at a disallowed destination (${bad}); page was closed`);
      }
    }
    return res;
  }

  async navigate(sbx: Sandbox, url: string, allowed: string[]) {
    await validateDestination(url, allowed, this.resolve);
    const res = await ctl(sbx, { action: 'navigate', url }, allowed);
    if (!res.ok) throw new BrowserPolicyError(res.error ?? 'navigation failed');
    return this.postCheck(sbx, res, allowed);
  }

  async read(sbx: Sandbox, allowed: string[]) {
    const res = await ctl(sbx, { action: 'read' }, allowed);
    if (!res.ok) throw new Error(res.error ?? 'read failed');
    return this.postCheck(sbx, res, allowed);
  }

  async screenshot(sbx: Sandbox, allowed: string[], fullPage: boolean) {
    const res = await ctl(sbx, { action: 'screenshot', fullPage }, allowed);
    if (!res.ok || !res.path) throw new Error(res.error ?? 'screenshot failed');
    await this.postCheck(sbx, res, allowed);
    const bytes = await sbx.files.read(res.path, { format: 'bytes' });
    await sbx.files.remove(res.path).catch(() => undefined);
    return { bytes, url: res.url ?? '', title: res.title ?? '' };
  }

  async click(sbx: Sandbox, allowed: string[], element: number) {
    const res = await ctl(sbx, { action: 'click', element }, allowed);
    if (!res.ok) throw new BrowserPolicyError(res.error ?? 'click failed');
    return this.postCheck(sbx, res, allowed);
  }

  async type(sbx: Sandbox, allowed: string[], element: number, text: string) {
    const res = await ctl(sbx, { action: 'type', element, text }, allowed);
    if (!res.ok) throw new BrowserPolicyError(res.error ?? 'typing failed');
    return res;
  }

  async scroll(sbx: Sandbox, allowed: string[], direction: 'up' | 'down') {
    const res = await ctl(sbx, { action: 'scroll', direction }, allowed);
    if (!res.ok) throw new Error(res.error ?? 'scroll failed');
    return res;
  }

  async download(sbx: Sandbox, allowed: string[], url: string) {
    await validateDestination(url, allowed, this.resolve);
    const res = await ctl(sbx, { action: 'download', url }, allowed);
    if (!res.ok || !res.path) throw new BrowserPolicyError(res.error ?? 'download failed');
    const final = checkBrowserUrl(res.url ?? '', allowed);
    if (!final.ok) throw new BrowserPolicyError(`download ended at a disallowed destination: ${final.reason}`);
    const bytes = await sbx.files.read(res.path, { format: 'bytes' });
    await sbx.files.remove(res.path).catch(() => undefined);
    return {
      bytes,
      url: res.url!,
      contentType: (res.contentType ?? '').split(';')[0]!.trim(),
      size: res.size ?? bytes.byteLength,
    };
  }
}
