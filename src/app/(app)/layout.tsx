import { redirect } from "next/navigation";
import { getOwner } from "@/server/auth/session";
import { ToastProvider } from "@/components/ui";
import { Splash } from "@/components/boot/splash";

/**
 * Everything inside this group is owner-only. Middleware redirects on a missing
 * cookie; this is the real check — it verifies the sealed session server-side.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const owner = await getOwner();
  if (!owner) redirect("/login");

  return (
    <ToastProvider>
      <Splash />
      {children}
    </ToastProvider>
  );
}
