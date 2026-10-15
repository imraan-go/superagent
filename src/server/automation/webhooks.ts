import "server-only";
import { randomBytes } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { webhooks } from "@/server/db/schema";
import { env } from "@/server/env";
import { seal } from "@/server/lib/crypto";
import { AppError } from "@/server/lib/errors";
import { callLhosText } from "./lhos-tools";
import { startPromptRun } from "./prompt-run";
import { wrapUntrustedPayload } from "./webhook-signature";

export const createWebhookSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("prompt"),
    name: z.string().trim().min(1).max(80),
    prompt: z.string().trim().min(1).max(8000),
    model: z.string().trim().min(1).max(120).optional(),
  }),
  z.object({
    kind: z.literal("workflow"),
    name: z.string().trim().min(1).max(80),
    workflow: z.string().trim().min(1).max(120),
  }),
]);

export interface WebhookView {
  id: string;
  name: string;
  url: string;
  target: { kind: "prompt" | "workflow"; prompt?: string | undefined; workflow?: string | undefined; model?: string | undefined };
  enabled: boolean;
  lastFiredAt: string | null;
  fireCount: number;
  createdAt: string;
}

export function webhookUrl(id: string): string {
  return `${env.APP_URL.replace(/\/$/, "")}/api/webhooks/${id}`;
}

function view(r: typeof webhooks.$inferSelect): WebhookView {
  return {
    id: r.id,
    name: r.name,
    url: webhookUrl(r.id),
    target: r.target,
    enabled: r.enabled,
    lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
    fireCount: r.fireCount,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listWebhooks(): Promise<WebhookView[]> {
  return (await db.select().from(webhooks).orderBy(desc(webhooks.createdAt))).map(view);
}

/** Returns the plaintext secret exactly once; only the sealed form is stored. */
export async function createWebhook(input: z.infer<typeof createWebhookSchema>): Promise<{ webhook: WebhookView; secret: string }> {
  const secret = `whsec_${randomBytes(32).toString("hex")}`;
  const target =
    input.kind === "prompt"
      ? { kind: "prompt" as const, prompt: input.prompt, ...(input.model ? { model: input.model } : {}) }
      : { kind: "workflow" as const, workflow: input.workflow };
  const [row] = await db.insert(webhooks).values({ name: input.name, secretEnc: seal(secret), target }).returning();
  if (!row) throw new AppError("internal", "Could not create the webhook.");
  return { webhook: view(row), secret };
}

export async function setWebhookEnabled(id: string, enabled: boolean): Promise<void> {
  const rows = await db.update(webhooks).set({ enabled }).where(eq(webhooks.id, id)).returning({ id: webhooks.id });
  if (rows.length === 0) throw new AppError("not_found", "No such webhook.");
}

export async function deleteWebhook(id: string): Promise<void> {
  const rows = await db.delete(webhooks).where(eq(webhooks.id, id)).returning({ id: webhooks.id });
  if (rows.length === 0) throw new AppError("not_found", "No such webhook.");
}

/** Fires a verified webhook. The payload is data, never instructions. */
export async function fireWebhook(
  hook: typeof webhooks.$inferSelect,
  rawBody: string,
): Promise<{ kind: "prompt"; chatId: string; runId: string } | { kind: "workflow"; output: string }> {
  await db
    .update(webhooks)
    .set({ lastFiredAt: new Date(), fireCount: sql`${webhooks.fireCount} + 1` })
    .where(eq(webhooks.id, hook.id));

  if (hook.target.kind === "workflow") {
    if (!hook.target.workflow) throw new AppError("bad_request", "Webhook has no workflow.");
    // Deliberate: the payload is NOT passed to the workflow. Saved workflows
    // template `{{vars}}` straight into tool args, so an external payload would
    // become arguments/instructions. Workflow targets run with their saved
    // defaults only; use a prompt target to process payloads (there they are
    // wrapped as untrusted data).
    const output = await callLhosText("workflow_run_saved", { name: hook.target.workflow });
    return { kind: "workflow", output: output.slice(0, 500) };
  }

  const text = `${hook.target.prompt ?? ""}\n\n${wrapUntrustedPayload(`webhook:${hook.name}`, rawBody)}`;
  const started = await startPromptRun({
    text,
    model: hook.target.model,
    title: `⚡ ${hook.name}`,
  });
  return { kind: "prompt", ...started };
}

/** LHOS trigger links for saved workflows (the URL carries a token: owner-only). */
export async function listTriggerUrls(): Promise<Array<{ workflow: string; description: string; url: string | null }>> {
  const raw = await callLhosText("workflow_list");
  let workflows: Array<{ name: string; description?: string }> = [];
  try {
    workflows = z.array(z.object({ name: z.string(), description: z.string().optional() }).passthrough()).parse(JSON.parse(raw));
  } catch {
    workflows = [];
  }
  return Promise.all(
    workflows.map(async (w) => {
      try {
        const out = await callLhosText("trigger_url", { workflow: w.name });
        const url = /https?:\/\/\S+/.exec(out)?.[0]?.replace(/["',)}\]]+$/, "") ?? null;
        return { workflow: w.name, description: w.description ?? "", url };
      } catch {
        return { workflow: w.name, description: w.description ?? "", url: null };
      }
    }),
  );
}
