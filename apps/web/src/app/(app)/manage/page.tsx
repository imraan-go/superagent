import type { Metadata } from "next";
import { ManageView } from "@/components/manage/manage-view";

export const metadata: Metadata = { title: "Workspaces — Superagent" };
export const dynamic = "force-dynamic";

export default function ManagePage() {
  return <ManageView />;
}
