"use client";

import { useRouter } from "next/navigation";
import { SignOut } from "@phosphor-icons/react/dist/ssr";
import { IconButton } from "@/components/ui";

export function SignOutButton({ email }: { email: string }) {
  const router = useRouter();

  return (
    <IconButton
      label={email ? `Sign out ${email}` : "Sign out"}
      icon={<SignOut size={16} />}
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    />
  );
}
