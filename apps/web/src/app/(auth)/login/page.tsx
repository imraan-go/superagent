import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOwner } from "@/server/api";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = { title: "Sign in — Superagent" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Already signed in → straight to the app.
  if (await getOwner()) redirect("/");

  const { next } = await searchParams;
  // Only accept same-site relative paths; an absolute URL here would be an
  // open-redirect.
  const nextPath = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <main className={styles.screen}>
      <LoginForm nextPath={nextPath} />
    </main>
  );
}
