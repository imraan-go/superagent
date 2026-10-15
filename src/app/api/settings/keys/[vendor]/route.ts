import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";
import { removeVendorKey, storeVendorKey } from "@/server/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ vendor: string }> };

/**
 * Vendor API keys. Write-only by design (rule 30-security): PUT seals and
 * stores, DELETE removes, and there is no GET — the status (last4 only) comes
 * from `GET /api/settings/models`.
 */
const bodySchema = z.object({
  key: z
    .string()
    .trim()
    .min(8, "That does not look like an API key.")
    .max(512)
    .regex(/^[\x21-\x7e]+$/, "Keys cannot contain spaces or control characters."),
});

export const PUT = ownerRoute<Ctx>(async ({ request, ctx }) => {
  const { vendor } = await ctx.params;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    throw new AppError("bad_request", body.error.issues[0]?.message ?? "Invalid key.");
  }
  return json(await storeVendorKey(vendor, body.data.key));
});

export const DELETE = ownerRoute<Ctx>(async ({ ctx }) => {
  const { vendor } = await ctx.params;
  return json({ removed: await removeVendorKey(vendor) });
});
