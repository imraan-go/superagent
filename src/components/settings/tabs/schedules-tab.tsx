"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, HoldToConfirm, SettingSection, useToast } from "@/components/ui";
import { api, fmtTime } from "./shared";
import styles from "./automation.module.css";

interface ScheduleView {
  id: string;
  source: "lhos" | "panel";
  name: string;
  cron: string;
  enabled: boolean;
  target: string;
  model: string | null;
  lastRun: string | null;
  nextRun: string | null;
  lastStatus: string | null;
  protected: boolean;
}

const KEY = ["automation", "schedules"];

/** Settings → Schedules: LHOS jobs (source of truth) + panel-native scheduled prompts. */
export function SchedulesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isPending, error } = useQuery({
    queryKey: KEY,
    queryFn: () => api<{ lhos: ScheduleView[]; lhosError: string | null; panel: ScheduleView[] }>("/api/automation/schedules"),
  });

  const act = useMutation({
    mutationFn: (v: { id: string; op: "toggle" | "delete" | "run"; enabled?: boolean }) =>
      v.op === "toggle"
        ? api(`/api/automation/schedules/${v.id}`, { method: "PATCH", body: { enabled: v.enabled } })
        : v.op === "delete"
          ? api(`/api/automation/schedules/${v.id}`, { method: "DELETE" })
          : api(`/api/automation/schedules/${v.id}`, { method: "POST" }),
    onSuccess: (_d, v) => {
      if (v.op === "run") toast.push({ title: "Started", tone: "success" });
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: Error) => toast.push({ title: "Schedule action failed", message: e.message, tone: "error" }),
  });

  const row = (s: ScheduleView) => (
    <div className={styles.item} key={s.id}>
      <div>
        <div className={styles.itemTitle}>
          {s.name}
          {!s.enabled && <span className={styles.badge}>paused</span>}
          {s.protected && <span className={styles.badge}>protected</span>}
        </div>
        <div className={styles.meta}>
          <span className={styles.mono}>{s.cron}</span> UTC · {s.source === "panel" ? `prompt${s.model ? ` · ${s.model}` : ""}` : s.target || "workflow"}
          {" · next "}
          {fmtTime(s.nextRun)} · last {fmtTime(s.lastRun)}
          {s.lastStatus ? ` (${s.lastStatus})` : ""}
        </div>
      </div>
      <div className={styles.actions}>
        {!s.protected && (
          <>
            <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: s.id, op: "run" })}>
              Run now
            </Button>
            <Button size="sm" variant="outline" onClick={() => act.mutate({ id: s.id, op: "toggle", enabled: !s.enabled })}>
              {s.enabled ? "Pause" : "Enable"}
            </Button>
            <HoldToConfirm size="sm" tone="danger" onConfirm={() => act.mutate({ id: s.id, op: "delete" })}>
              Delete
            </HoldToConfirm>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className={styles.stack}>
      <SettingSection title="Scheduled prompts">
        <div className={styles.list}>
          {isPending && <div className={styles.empty}>Loading…</div>}
          {error && <div className={styles.error}>{error.message}</div>}
          {data?.panel.length === 0 && <div className={styles.empty}>No scheduled prompts yet.</div>}
          {data?.panel.map(row)}
        </div>
        <NewSchedule source="panel" />
      </SettingSection>

      <SettingSection title="Agent computer schedules (LHOS)">
        <div className={styles.list}>
          {data?.lhosError && <div className={styles.error}>LHOS unreachable — showing cache. {data.lhosError}</div>}
          {data?.lhos.length === 0 && <div className={styles.empty}>No LHOS schedules.</div>}
          {data?.lhos.map(row)}
        </div>
        <NewSchedule source="lhos" />
      </SettingSection>
    </div>
  );
}

function NewSchedule({ source }: { source: "panel" | "lhos" }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 8 * * *");
  const [text, setText] = useState("");
  const [model, setModel] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api("/api/automation/schedules", {
        method: "POST",
        body:
          source === "panel"
            ? { source, name, cron, prompt: text, ...(model ? { model } : {}) }
            : { source, name, cron, workflow: text },
      }),
    onSuccess: () => {
      setName("");
      setText("");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: Error) => toast.push({ title: "Could not create schedule", message: e.message, tone: "error" }),
  });

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className={styles.formRow}>
        <input className={styles.input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className={styles.input} placeholder="Cron (UTC)" value={cron} onChange={(e) => setCron(e.target.value)} required aria-label="Cron expression" />
        {source === "panel" && (
          <input className={styles.input} placeholder="Model id (optional)" value={model} onChange={(e) => setModel(e.target.value)} />
        )}
      </div>
      {source === "panel" ? (
        <textarea className={styles.textarea} placeholder="Prompt, e.g. Give me an inbox brief" value={text} onChange={(e) => setText(e.target.value)} required />
      ) : (
        <input className={styles.input} placeholder="Saved workflow name" value={text} onChange={(e) => setText(e.target.value)} required />
      )}
      <div className={styles.actions}>
        <Button size="sm" variant="primary" type="submit" loading={create.isPending}>
          Add schedule
        </Button>
      </div>
    </form>
  );
}
