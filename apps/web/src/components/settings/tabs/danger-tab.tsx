"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { HoldToConfirm, SettingRow, SettingSection } from "@/components/ui";
import { settingsFetch, useSettingsSection } from "@/hooks/use-settings";
import { InlineError } from "../controls";
import styles from "../settings-tabs.module.css";

interface DeleteResult {
  ok: true;
  residual: string[];
}

export function DangerTab() {
  const router = useRouter();
  const manage = useSettingsSection("manage");
  const holdMs = manage.value.confirmHoldMs;

  const signOutAll = useMutation({
    mutationFn: () => settingsFetch("/api/auth/revoke-sessions", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      router.replace("/login");
      router.refresh();
    },
  });
  const wipe = useMutation({
    mutationFn: () => settingsFetch<DeleteResult>("/api/me/data", { method: "DELETE" }),
  });

  return (
    <SettingSection title="Danger zone">
      <SettingRow label="Sign out everywhere" description="Ends every session, including this one.">
        <HoldToConfirm tone="danger" size="sm" holdMs={holdMs} hint="hold" disabled={signOutAll.isPending} onConfirm={() => signOutAll.mutate()}>
          Sign out all
        </HoldToConfirm>
      </SettingRow>
      <SettingRow
        label="Delete all my data"
        description="Chats, runs, files, memories, routines and app connections. Stop running tasks first. Your account stays."
      >
        <HoldToConfirm tone="danger" size="sm" holdMs={Math.max(holdMs, 1200)} hint="hold" disabled={wipe.isPending} onConfirm={() => wipe.mutate()}>
          Delete data
        </HoldToConfirm>
      </SettingRow>
      {wipe.data && (
        <div className={styles.banner} role="status">
          Deleted. What remains elsewhere: {wipe.data.residual.join(" ")}
        </div>
      )}
      <div className={styles.row} style={{ padding: "0 var(--sp-4)" }}>
        <InlineError error={signOutAll.error ?? wipe.error} />
      </div>
    </SettingSection>
  );
}
