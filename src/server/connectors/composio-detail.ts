import "server-only";
import { ComposioClient } from "./composio-client";
import { getComposioConfig } from "./composio-config";
import { getToolkitDetail } from "./composio-tools";
import type { ToolkitDetail } from "./composio-catalog";

/** Detail with the owner's saved tool selection joined in. */
export async function getToolkitDetailForOwner(client: ComposioClient, slug: string): Promise<ToolkitDetail> {
  const cfg = await getComposioConfig();
  return getToolkitDetail(client, slug, async (tk) => cfg.tools[tk]);
}
