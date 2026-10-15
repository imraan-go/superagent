import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrimitivesGallery } from "./gallery";

/**
 * Visual proof sheet for the design-system primitives: every variant, every
 * state, both themes, checked at 375 px and 1440 px (rule 40-workflow §5).
 * Development only — the route 404s in production.
 */
export const metadata: Metadata = { title: "Primitives — Flight Deck" };

export default function PrimitivesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PrimitivesGallery />;
}
