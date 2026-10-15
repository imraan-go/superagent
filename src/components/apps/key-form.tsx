"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Key } from "@phosphor-icons/react/dist/ssr";
import { api } from "@/components/settings/tabs/shared";
import { Button, useToast } from "@/components/ui";
import { COMPOSIO_STATUS_KEY } from "@/lib/composio-types";
import styles from "./apps.module.css";

/** Shown instead of the catalog until a Composio key exists. Uses the existing sealed-secret route; the key is never echoed. */
export function KeyForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const [key, setKey] = useState("");
  const save = useMutation({
    mutationFn: () => api("/api/connectors/composio", { method: "POST", body: { action: "setKey", key } }),
    onSuccess: () => {
      setKey("");
      void qc.invalidateQueries({ queryKey: COMPOSIO_STATUS_KEY });
    },
    onError: (e: Error) => toast.push({ title: "Composio", message: e.message, tone: "error" }),
  });
  return (
    <form
      className={styles.keyForm}
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Key size={32} weight="duotone" aria-hidden className={styles.keyIcon} />
      <h3 className={styles.sectionHead}>Add your Composio API key</h3>
      <p className={styles.muted}>
        One key unlocks the whole Composio catalog: Gmail, Drive, Notion, LinkedIn, Slack and 1,600+ more apps. It is stored encrypted and never shown again. Get one from{" "}
        <a className={styles.link} href="https://platform.composio.dev" target="_blank" rel="noopener noreferrer">
          platform.composio.dev
        </a>
        .
      </p>
      <div className={styles.keyRow}>
        <input className={styles.input} type="password" autoComplete="off" placeholder="Composio API key" aria-label="Composio API key" value={key} onChange={(e) => setKey(e.target.value)} required minLength={8} />
        <Button type="submit" variant="primary" loading={save.isPending}>
          Save key
        </Button>
      </div>
    </form>
  );
}
