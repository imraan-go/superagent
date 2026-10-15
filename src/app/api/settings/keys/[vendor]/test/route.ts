import { json, ownerRoute } from "@/server/lib/route";
import { testVendorKey } from "@/server/models";
import { enforceRateLimit } from "@/server/lib/rate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ vendor: string }> };

/** Owner-clicked key check against the vendor's free metadata endpoint. */
export const POST = ownerRoute<Ctx>(async ({ ctx }) => {
  enforceRateLimit("keyTest");
  const { vendor } = await ctx.params;
  return json(await testVendorKey(vendor));
});
