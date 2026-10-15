import { env } from "@/server/env";
import { json, ownerRoute } from "@/server/lib/route";
import { frameAncestorsAllows } from "./frame-ancestors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tells the client where the VNC viewer lives and whether it allows framing.
 *
 * The viewer URL is not a secret (it has its own access-code sign-in, which
 * renders inside the iframe — no popup), so it is exposed here rather than
 * through a NEXT_PUBLIC variable. VNC traffic never touches this server.
 *
 * The viewer sends `Content-Security-Policy: frame-ancestors 'self' <panel>`;
 * `embeddable` reports whether that list includes this panel's origin. The
 * client always frames the viewer and only shows `reason` as a hint.
 */
let cache: { at: number; value: ViewerInfo } | null = null;

interface ViewerInfo {
  url: string;
  embeddable: boolean;
  reason: string | null;
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
    const csp = res.headers.get("content-security-policy");
    const allowed = csp ? frameAncestorsAllows(csp, panelOrigin) : null;
    if (allowed === false) {
      return {
        url,
        embeddable: false,
        reason: `The viewer's frame-ancestors does not list ${panelOrigin}.`,
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
