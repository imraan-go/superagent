import { isIP } from 'node:net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  'instance-data',
  'host.docker.internal',
  'gateway.docker.internal',
]);

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_PRIVATE: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

export const PRIVATE_CIDRS_V4 = V4_PRIVATE.map(([b, m]) => `${b}/${m}`);

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return V4_PRIVATE.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (kind === 6) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true;
    if (v.startsWith('fc') || v.startsWith('fd')) return true;
    if (v.startsWith('ff')) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return false;
  }
  return true;
}

export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p || h === `www.${p}`;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Static validation of a browser destination. DNS resolution checks happen separately in the
 * trusted worker (see `assertPublicResolution`) because they require network access.
 */
export function checkBrowserUrl(raw: string, allowedDomains: string[]): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid absolute URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: `scheme ${url.protocol} is not allowed` };
  if (url.username || url.password) return { ok: false, reason: 'credentials in URL are not allowed' };
  if (url.port && url.port !== '80' && url.port !== '443') return { ok: false, reason: 'non-standard ports are not allowed' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return { ok: false, reason: 'IP-literal destinations are not allowed' };
  if (BLOCKED_HOSTNAMES.has(host.toLowerCase()) || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    return { ok: false, reason: 'internal hostnames are not allowed' };
  }
  if (allowedDomains.length === 0) return { ok: false, reason: 'task has no approved browsing domains' };
  if (!allowedDomains.some((d) => hostMatches(host, d))) return { ok: false, reason: `${host} is not in this task's approved domains` };
  return { ok: true, url };
}
