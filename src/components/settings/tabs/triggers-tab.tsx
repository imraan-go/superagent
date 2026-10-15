"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, HoldToConfirm, SegmentedSwitch, SettingSection, useToast } from "@/components/ui";
import { api, copy, fmtTime } from "./shared";
import styles from "./automation.module.css";

interface WebhookView {
  id: string;
  name: string;
  url: string;
  target: { kind: "prompt" | "workflow"; prompt?: string; workflow?: string; model?: string };
  enabled: boolean;
  lastFiredAt: string | null;
  fireCount: number;
}

const KEY = ["automation", "webhooks"];

const SIGNING_HELP = `ts=$(date +%s)
sig=$(printf '%s.%s' "$ts" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
curl -X POST "$URL" -H "content-type: application/json" \\
  -H "x-panel-timestamp: $ts" -H "x-panel-signature: sha256=$sig" -d "$BODY"`;

/** Settings → Triggers & Webhooks: signed inbound webhooks + LHOS trigger URLs. */
export function TriggersTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const hooks = useQuery({
    queryKey: KEY,
    queryFn: () => api<{ webhooks: WebhookView[] }>("/api/automation/webhooks"),
  });
  const triggers = useQuery({
    queryKey: ["automation", "triggers"],
    queryFn: () => api<{ triggers: Array<{ workflow: string; description: string; url: string | null }> }>("/api/automation/triggers"),
  });

  const act = useMutation({
    mutationFn: (v: { id: string; op: "toggle" | "delete"; enabled?: boolean }) =>
      v.op === "toggle"
        ? api(`/api/automation/webhooks/${v.id}`, { method: "PATCH", body: { enabled: v.enabled } })
        : api(`/api/automation/webhooks/${v.id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e: Error) => toast.push({ title: "Webhook action failed", message: e.message, tone: "error" }),
  });

  return (
    <div className={styles.stack}>
      <SettingSection title="Inbound webhooks">
        <div className={styles.list}>
          {hooks.isPending && <div className={styles.empty}>Loading…</div>}
          {hooks.error && <div className={styles.error}>{hooks.error.message}</div>}
          {hooks.data?.webhooks.length === 0 && <div className={styles.empty}>No webhooks yet.</div>}
          {hooks.data?.webhooks.map((h) => (
            <div className={styles.item} key={h.id}>
              <div>
                <div className={styles.itemTitle}>
                  {h.name}
                  <span className={styles.badge}>{h.target.kind === "prompt" ? "agent prompt" : `workflow · ${h.target.workflow}`}</span>
                  {!h.enabled && <span className={styles.badge}>off</span>}
                </div>
                <div className={`${styles.meta} ${styles.mono}`}>{h.url}</div>
                <div className={styles.meta}>
                  Fired {h.fireCount}× · last {fmtTime(h.lastFiredAt)}
                </div>
              </div>
              <div className={styles.actions}>
                <Button size="sm" variant="ghost" onClick={() => copy(h.url)}>
                  Copy URL
                </Button>
                <Button size="sm" variant="outline" onClick={() => act.mutate({ id: h.id, op: "toggle", enabled: !h.enabled })}>
                  {h.enabled ? "Disable" : "Enable"}
                </Button>
                <HoldToConfirm size="sm" tone="danger" onConfirm={() => act.mutate({ id: h.id, op: "delete" })}>
                  Delete
                </HoldToConfirm>
              </div>
            </div>
          ))}
        </div>
        <NewWebhook />
      </SettingSection>

      <SettingSection title="Signing (Pipedream, Zapier, scripts)">
        <div className={styles.form}>
          <div className={styles.meta}>
            POST JSON to the webhook URL with <span className={styles.mono}>x-panel-timestamp</span> (unix seconds, ±5 min)
            and <span className={styles.mono}>x-panel-signature: sha256=HMAC_SHA256(secret, timestamp + &quot;.&quot; + rawBody)</span>.
            Payloads are capped at 256 KB. Prompt targets receive them as untrusted data, never instructions; workflow targets ignore the payload and run with their saved defaults.
          </div>
          <code className={styles.code}>{SIGNING_HELP}</code>
        </div>
      </SettingSection>

      <SettingSection title="LHOS workflow trigger URLs">
        <div className={styles.list}>
          {triggers.isPending && <div className={styles.empty}>Loading…</div>}
          {triggers.error && <div className={styles.error}>{triggers.error.message}</div>}
          {triggers.data?.triggers.length === 0 && <div className={styles.empty}>No saved workflows.</div>}
          {triggers.data?.triggers.map((t) => (
            <div className={styles.item} key={t.workflow}>
              <div>
                <div className={styles.itemTitle}>{t.workflow}</div>
                <div className={styles.meta}>{t.description || "Contains a token — treat as a secret."}</div>
              </div>
              <div className={styles.actions}>
                <Button size="sm" variant="ghost" disabled={!t.url} onClick={() => t.url && copy(t.url)}>
                  Copy trigger URL
                </Button>
              </div>
            </div>
          ))}
        </div>
      </SettingSection>
    </div>
  );
}

function NewWebhook() {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<"prompt" | "workflow">("prompt");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [model, setModel] = useState("");
  const [created, setCreated] = useState<{ url: string; secret: string } | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api<{ webhook: WebhookView; secret: string }>("/api/automation/webhooks", {
        method: "POST",
        body: kind === "prompt" ? { kind, name, prompt: text, ...(model ? { model } : {}) } : { kind, name, workflow: text },
      }),
    onSuccess: (d) => {
      setCreated({ url: d.webhook.url, secret: d.secret });
      setName("");
      setText("");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: Error) => toast.push({ title: "Could not create webhook", message: e.message, tone: "error" }),
  });

  return (
    <>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className={styles.formRow}>
          <SegmentedSwitch<"prompt" | "workflow">
            label="Target"
            size="sm"
            value={kind}
            onChange={setKind}
            options={[
              { value: "prompt", label: "Agent prompt" },
              { value: "workflow", label: "LHOS workflow" },
            ]}
          />
          <input className={styles.input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          {kind === "prompt" && (
            <input className={styles.input} placeholder="Model id (optional)" value={model} onChange={(e) => setModel(e.target.value)} />
          )}
        </div>
        {kind === "prompt" ? (
          <textarea className={styles.textarea} placeholder="What should the agent do with each event?" value={text} onChange={(e) => setText(e.target.value)} required />
        ) : (
          <input className={styles.input} placeholder="Saved workflow name" value={text} onChange={(e) => setText(e.target.value)} required />
        )}
        <div className={styles.actions}>
          <Button size="sm" variant="primary" type="submit" loading={create.isPending}>
            Create webhook
          </Button>
        </div>
      </form>
      {created && (
        <div className={styles.secretBox} role="status">
          <strong>Copy the signing secret now — it will not be shown again.</strong>
          <code className={styles.code}>{created.url}</code>
          <code className={styles.code}>{created.secret}</code>
          <div className={styles.actions}>
            <Button size="sm" variant="outline" onClick={() => copy(created.secret)}>
              Copy secret
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
