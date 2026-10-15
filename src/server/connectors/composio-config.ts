import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { connectors } from "@/server/db/schema";
import { seal, unseal } from "@/server/lib/crypto";

/**
 * Owner's Composio preferences, kept in ONE `connectors` row (kind=composio,
 * name="composio-config") so no migration is needed:
 *  - tools:        per toolkit, the action slugs the owner enabled. A toolkit
 *                  with no entry uses the default (read-only tools only).
 *  - mcp:          the Composio-hosted MCP server created for the owner and the
 *                  panel `connectors` row that registers it.
 *  - triggers:     Composio trigger instance -> panel webhook (prompt target).
 *  - subscription: the project webhook subscription id + sealed signing secret.
 * No API credential is ever stored here.
 */
export const CONFIG_NAME = "composio-config";

const configSchema = z.object({
  tools: z.record(z.string(), z.array(z.string())).default({}),
  mcp: z.object({ serverId: z.string(), name: z.string(), panelServerId: z.string().nullable().default(null) }).nullable().default(null),
  triggers: z
    .array(
      z.object({
        triggerId: z.string(),
        slug: z.string(),
        toolkit: z.string(),
        webhookId: z.string(),
        prompt: z.string(),
      }),
    )
    .default([]),
  subscription: z.object({ id: z.string(), secretEnc: z.string() }).nullable().default(null),
});

export type ComposioConfig = z.infer<typeof configSchema>;

async function row() {
  const [r] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.kind, "composio"), eq(connectors.name, CONFIG_NAME)))
    .limit(1);
  return r ?? null;
}

export async function getComposioConfig(): Promise<ComposioConfig> {
  const r = await row();
  const parsed = configSchema.safeParse(r?.config ?? {});
  return parsed.success ? parsed.data : configSchema.parse({});
}

export async function updateComposioConfig(fn: (c: ComposioConfig) => ComposioConfig): Promise<ComposioConfig> {
  const next = configSchema.parse(fn(await getComposioConfig()));
  const existing = await row();
  if (existing) await db.update(connectors).set({ config: next }).where(eq(connectors.id, existing.id));
  else await db.insert(connectors).values({ kind: "composio", name: CONFIG_NAME, config: next });
  return next;
}

export function sealSecret(v: string): string {
  return seal(v);
}
export function openSecret(v: string): string | null {
  try {
    return unseal(v);
  } catch {
    return null;
  }
}
