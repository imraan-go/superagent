import { env } from "@/server/env";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tells the client where the VNC viewer lives and whether it can be framed.
 *
 * The viewer URL is not a secret (it has its own access-code sign-in), so it
 * is exposed here rather than through a NEXT_PUBLIC variable. VNC traffic
 * itself never touches this server.
 *
 * `embeddable` is derived from the viewer's own response headers: an
 * `X-Frame-Options` of DENY/SAMEORIGIN or a restrictive `frame-ancestors`
 * makes the browser refuse the iframe, and the panel should then offer the
 * deep-link card instead of a blank frame (skill-vnc-embed §Gotchas).
 */
let cache: { at: number; value: ViewerInfo } | null = null;

interface ViewerInfo {
  url: string;
  embeddable: boolean;
  reason: string | null;
}

function frameAncestorsBlocks(csp: string, panelOrigin: string): boolean {
  const directive = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.toLowerCase().startsWith("frame-ancestors"));
  if (!directive) return false;
  const sources = directive.split(/\s+/).slice(1);
  if (sources.includes("*")) return false;
  const host = new URL(panelOrigin).host;
  return !sources.some((s) => s === panelOrigin || s === host || s === `*.${host.split(".").slice(1).join(".")}`);
}

async function probe(panelOrigin: string): Promise<ViewerInfo> {
  const url = env.LHOS_VNC_URL;
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(6_000),
      cache: "no-store",
    });
    const xfo = res.headers.get("x-frame-options")?.toLowerCase().trim();
    if (xfo === "deny" || xfo === "sameorigin") {
      return {
        url,
        embeddable: false,
        reason: `The viewer sends X-Frame-Options: ${xfo.toUpperCase()}, so browsers refuse to frame it.`,
      };
    }
    const csp = res.headers.get("content-security-policy");
    if (csp && frameAncestorsBlocks(csp, panelOrigin)) {
      return {
        url,
        embeddable: false,
        reason: "The viewer's Content-Security-Policy frame-ancestors does not allow this panel.",
      };
    }
    return { url, embeddable: true, reason: null };
  } catch {
    // Unreachable from the server does not mean unreachable from the browser.
    return { url, embeddable: true, reason: null };
  }
}

export const GET = ownerRoute(async () => {
  const origin = new URL(env.APP_URL).origin;
  if (!cache || Date.now() - cache.at > 60_000) {
    cache = { at: Date.now(), value: await probe(origin) };
  }
  return json(cache.value);
});
