"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HoldToConfirm, SettingRow, SettingSection } from "@/components/ui";
import { settingsFetch, useSettingsSection } from "@/hooks/use-settings";
import { InlineError } from "../controls";
import styles from "../settings-tabs.module.css";

export function DangerTab() {
  const qc = useQueryClient();
  const router = useRouter();
  const usage = useSettingsSection("usage");
  const manage = useSettingsSection("manage");
  const holdMs = manage.value.confirmHoldMs;

  const act = useMutation({
    mutationFn: (action: "archiveUsage" | "signOutEverywhere") =>
      settingsFetch<{ ok: true; signedOut?: boolean }>("/api/settings/danger", {
        method: "POST",
        body: JSON.stringify({ action }),
      }),
    onSuccess: (result) => {
      if (result.signedOut) {
        router.replace("/login");
        router.refresh();
        return;
      }
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  return (
    <SettingSection title="Danger zone">
      <SettingRow
        label="Archive usage counters"
        description={
          usage.value.archivedAt
            ? `Archived ${new Date(usage.value.archivedAt).toLocaleString()}. The Usage view starts from here; no rows were deleted.`
            : "Start the Usage view fresh from now. History is kept, only the starting mark moves."
        }
      >
        <HoldToConfirm
          tone="attention"
          size="sm"
          holdMs={holdMs}
          hint="hold"
          disabled={act.isPending}
          onConfirm={() => act.mutate("archiveUsage")}
        >
          Archive
        </HoldToConfirm>
      </SettingRow>
      <SettingRow
        label="Sign out everywhere"
        description="Ends every session, including this one."
      >
        <HoldToConfirm
          tone="danger"
          size="sm"
          holdMs={holdMs}
          hint="hold"
          disabled={act.isPending}
          onConfirm={() => act.mutate("signOutEverywhere")}
        >
          Sign out all
        </HoldToConfirm>
      </SettingRow>
      <div className={styles.row} style={{ padding: "0 var(--sp-4)" }}>
        <InlineError error={act.error} />
      </div>
    </SettingSection>
  );
}
