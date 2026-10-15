import { z } from "zod";
import { callLhosJson, callLhosText } from "@/server/automation/lhos-tools";
import { assertPublicUrl } from "@/server/lib/ssrf";
import { parseBody } from "@/server/lib/body";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Custom REST connectors live in the LHOS vault (INTEGRATIONS.md §6). The
 * panel lists connectors + credential *names* and hands out the vault intake
 * link; raw keys are typed on the LHOS page and never transit the panel or a
 * model.
 */
export const GET = ownerRoute(async () => {
  const [connectors, secrets, intake] = await Promise.allSettled([
    callLhosJson("connector_list"),
    callLhosJson("secret_list"),
    callLhosText("secret_intake_url"),
  ]);
  const intakeUrl =
    intake.status === "fulfilled" ? (/https:\/\/\S+/.exec(intake.value)?.[0]?.replace(/["',)}\]]+$/, "") ?? null) : null;
  return json({
    connectors: connectors.status === "fulfilled" && Array.isArray(connectors.value) ? connectors.value : [],
    credentials: secrets.status === "fulfilled" && Array.isArray(secrets.value) ? secrets.value : [],
    intakeUrl,
    error: connectors.status === "rejected" ? String(connectors.reason) : null,
  });
});

export const POST = ownerRoute(async ({ request }) => {
  const body = await parseBody(
    request,
    z.object({
      name: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/i, "Use letters, digits, dash or underscore."),
      baseUrl: z.url().refine((u) => u.startsWith("https://"), "Must be an https URL."),
      credential: z.string().trim().max(80).default(""),
      note: z.string().trim().max(300).default(""),
    }),
  );
  // Called from the agent computer, not this host, but a private/loopback
  // base URL is never a legitimate REST connector.
  await assertPublicUrl(body.baseUrl, { requireHttps: true });
  const out = await callLhosText("connector_save", {
    name: body.name,
    base_url: body.baseUrl,
    credential: body.credential,
    note: body.note,
  });
  return json({ ok: true, message: out.slice(0, 300) }, { status: 201 });
});
