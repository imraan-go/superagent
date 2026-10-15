import { z } from "zod";
import { invalidateExternalTools } from "@/server/connectors/external-tools";
import { assertSafeConnectorUrl, getPipedream, setPipedreamSource } from "@/server/connectors/store";
import { env } from "@/server/env";
import { parseBody } from "@/server/lib/body";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workflowSchema = z
  .object({ data: z.array(z.object({ id: z.string(), name: z.string().optional() }).passthrough()).default([]) })
  .passthrough();

/** Outbound source (host only — the URL itself is sealed) + optional workflow list. */
export const GET = ownerRoute(async () => {
  const pd = await getPipedream();
  let workflows: Array<{ id: string; name: string }> | null = null;
  let error: string | null = null;
  if (env.PIPEDREAM_API_KEY) {
    try {
      const res = await fetch("https://api.pipedream.com/v1/users/me/workflows", {
        headers: { authorization: `Bearer ${env.PIPEDREAM_API_KEY}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Pipedream HTTP ${res.status}`);
      workflows = workflowSchema.parse(await res.json()).data.map((w) => ({ id: w.id, name: w.name ?? w.id }));
    } catch (err) {
      error = err instanceof Error ? err.message : "Pipedream is unreachable.";
    }
  }
  return json({ sourceHost: pd?.host ?? null, hasApiKey: Boolean(env.PIPEDREAM_API_KEY), workflows, error });
});

export const POST = ownerRoute(async ({ request }) => {
  const body = await parseBody(
    request,
    z.object({ sourceUrl: z.url().refine((u) => u.startsWith("https://"), "Must be an https URL.").nullable() }),
  );
  if (body.sourceUrl) await assertSafeConnectorUrl(body.sourceUrl, { requireHttps: true });
  await setPipedreamSource(body.sourceUrl);
  invalidateExternalTools();
  return json({ ok: true });
});
