import { z } from "zod";
import { getCatalog } from "@/server/connectors/composio-tools";
import { ComposioClient } from "@/server/connectors/composio-client";
import { getComposioKey } from "@/server/connectors/store";
import { parseQuery } from "@/server/lib/body";
import { AppError } from "@/server/lib/errors";
import { ownerRoute } from "@/server/lib/route";
import { assertPublicUrl } from "@/server/lib/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 256 * 1024;

/**
 * Same-origin logo proxy: the CSP allows `img-src 'self'` only. The URL is
 * never taken from the request - only the slug, resolved through the cached
 * Composio catalog - and is SSRF-checked before it is fetched.
 */
export const GET = ownerRoute(async ({ request }) => {
  const { slug } = parseQuery(request.url, z.object({ slug: z.string().trim().regex(/^[a-z0-9_-]{1,64}$/i) }));
  const key = await getComposioKey();
  if (!key) throw new AppError("bad_request", "Add your Composio API key first.");
  const tk = (await getCatalog(new ComposioClient(key.key))).toolkits.find((t) => t.slug === slug);
  if (!tk?.logo) throw new AppError("not_found", "No logo.");
  await assertPublicUrl(tk.logo, { requireHttps: true });
  const res = await fetch(tk.logo, { signal: AbortSignal.timeout(8_000), redirect: "error" });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) throw new AppError("not_found", "No logo.");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new AppError("not_found", "No logo.");
  return new Response(buf, {
    headers: {
      "content-type": type,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
