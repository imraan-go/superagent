import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@/server/lib/errors";

/**
 * SSRF guard for owner-entered URLs the *panel host* fetches (MCP servers,
 * Pipedream source). The panel shares a host with the Manage bridge
 * (127.0.0.1:7071), Postgres and LHOS, so a URL that resolves to loopback,
 * a private range or link-local metadata must never be fetched — unless it is
 * exactly the configured LHOS origin (the built-in MCP server).
 *
 * Pure-ish: DNS resolution is injectable for tests. Callers should also fetch
 * with `redirect: "error"` so a public URL cannot bounce to a private one.
 */
export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** True for any address that must not be reachable from an owner-entered URL. */
export function isPrivateAddress(address: string): boolean {
  let ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);

  // IPv4-mapped / -compatible IPv6 (::ffff:127.0.0.1, ::ffff:7f00:1).
  const mapped = /^(?:0{0,4}:){0,5}(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped?.[1] && ip.includes(":")) return isPrivateAddress(mapped[1]);
  const mappedHex = /^(?:0{0,4}:){0,5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mappedHex?.[1] && mappedHex[2]) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }

  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 || // "this network"
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast + reserved + broadcast
    );
  }
  if (isIP(ip) === 6) {
    return (
      ip === "::" ||
      ip === "::1" ||
      /^f[cd]/.test(ip) || // unique local
      /^fe[89ab]/.test(ip) || // link-local
      /^ff/.test(ip) || // multicast
      ip.startsWith("64:ff9b:") // NAT64 can reach v4 private space
    );
  }
  // Not an address at all: treat as unsafe.
  return true;
}

/**
 * Throws `bad_request` unless `raw` is an http(s) URL whose host resolves only
 * to public addresses, or whose origin is one of `allowOrigins`.
 */
export async function assertPublicUrl(
  raw: string,
  opts: { allowOrigins?: readonly string[]; requireHttps?: boolean; resolve?: Resolver } = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("bad_request", "That is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AppError("bad_request", "Only http(s) URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new AppError("bad_request", "Put credentials in the token field, not the URL.");
  }

  const allowed = (opts.allowOrigins ?? []).some((o) => {
    try {
      return new URL(o).origin === url.origin;
    } catch {
      return false;
    }
  });
  if (allowed) return url;

  if (opts.requireHttps && url.protocol !== "https:") {
    throw new AppError("bad_request", "Must be an https URL.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) {
    throw new AppError("bad_request", "That URL points at a private or local address.");
  }

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await (opts.resolve ?? defaultResolver)(host);
    } catch {
      throw new AppError("bad_request", "That host name does not resolve.");
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new AppError("bad_request", "That URL points at a private or local address.");
  }
  return url;
}
