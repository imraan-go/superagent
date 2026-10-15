import type { Metadata } from "next";
import { ManageView } from "@/components/manage/manage-view";

export const metadata: Metadata = { title: "Manage — Flight Deck" };
export const dynamic = "force-dynamic";

export default function ManagePage() {
  return <ManageView />;
}
