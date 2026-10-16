"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, HoldToConfirm, SegmentedSwitch, SettingSection, useToast } from "@/components/ui";
import { api, fmtTime } from "./shared";
import styles from "./automation.module.css";

type Spec = { kind: "cron"; cron: string } | { kind: "interval"; everyMinutes: number };

export interface RoutineView {
  id: string;
  name: string;
  prompt: string;
  spec: Spec;
  timezone: string;
  state: "pending_create" | "active" | "paused" | "deleted";
  chatId: string | null;
  createdAt: string;
}

export const ROUTINES_KEY = ["schedules"] as const;

export function describeSpec(spec: Spec): string {
  return spec.kind === "cron" ? `cron ${spec.cron}` : `every ${spec.everyMinutes} min`;
}

/**
 * Settings → Schedules: routines (Temporal Schedules). The same records the agent manages from
 * chat; runs are read-only and post their results to the chat that created them.
 */
export function SchedulesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isPending, error } = useQuery({
    queryKey: ROUTINES_KEY,
    queryFn: () => api<{ schedules: RoutineView[] }>("/api/schedules"),
  });

  const act = useMutation({
    mutationFn: (v: { id: string; op: "pause" | "resume" | "delete" }) =>
      v.op === "delete" ? api(`/api/schedules/${v.id}`, { method: "DELETE" }) : api(`/api/schedules/${v.id}/${v.op}`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ROUTINES_KEY }),
    onError: (e: Error) => toast.push({ title: "Routine action failed", message: e.message, tone: "error" }),
  });

  const routines = (data?.schedules ?? []).filter((s) => s.state !== "deleted");

  return (
    <div className={styles.stack}>
      <SettingSection title="Routines">
        <p className={styles.meta}>
          Ask in any chat (“check my inbox every weekday at 8”) or add one here. Routines run read-only, never overlap,
          and catch up briefly after downtime.
        </p>
        <div className={styles.list}>
          {isPending && <div className={styles.empty}>Loading…</div>}
          {error && <div className={styles.error}>{error.message}</div>}
          {data && routines.length === 0 && <div className={styles.empty}>No routines yet.</div>}
          {routines.map((s) => (
            <div className={styles.item} key={s.id}>
              <div>
                <div className={styles.itemTitle}>
                  {s.name}
                  {s.state === "paused" && <span className={styles.badge}>paused</span>}
                  {s.state === "pending_create" && <span className={styles.badge}>starting</span>}
                </div>
                <div className={styles.meta}>
                  <span className={styles.mono}>{describeSpec(s.spec)}</span> · {s.timezone} · created {fmtTime(s.createdAt)}
                  {s.chatId && (
                    <>
                      {" · "}
                      <Link href={`/chat/${s.chatId}`}>open chat</Link>
                    </>
                  )}
                </div>
                <div className={styles.meta} title={s.prompt}>
                  {s.prompt.length > 140 ? `${s.prompt.slice(0, 140)}…` : s.prompt}
                </div>
              </div>
              <div className={styles.actions}>
                {s.state === "paused" ? (
                  <Button size="sm" variant="outline" onClick={() => act.mutate({ id: s.id, op: "resume" })}>
                    Resume
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => act.mutate({ id: s.id, op: "pause" })}>
                    Pause
                  </Button>
                )}
                <HoldToConfirm size="sm" tone="danger" onConfirm={() => act.mutate({ id: s.id, op: "delete" })}>
                  Delete
                </HoldToConfirm>
              </div>
            </div>
          ))}
        </div>
        <NewRoutine />
      </SettingSection>
    </div>
  );
}

function NewRoutine() {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<"cron" | "interval">("cron");
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 8 * * 1-5");
  const [every, setEvery] = useState(60);
  const [prompt, setPrompt] = useState("");
  const timezone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

  const create = useMutation({
    mutationFn: () =>
      api("/api/schedules", {
        method: "POST",
        body: { name, prompt, timezone, spec: kind === "cron" ? { kind, cron } : { kind, everyMinutes: every } },
      }),
    onSuccess: () => {
      setName("");
      setPrompt("");
      void qc.invalidateQueries({ queryKey: ROUTINES_KEY });
    },
    onError: (e: Error) => toast.push({ title: "Could not create the routine", message: e.message, tone: "error" }),
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
        <SegmentedSwitch
          label="Timing"
          size="sm"
          value={kind}
          onChange={setKind}
          options={[
            { value: "cron", label: "Cron" },
            { value: "interval", label: "Every N min" },
          ]}
        />
        {kind === "cron" ? (
          <input className={styles.input} value={cron} onChange={(e) => setCron(e.target.value)} required aria-label="Cron expression" />
        ) : (
          <input
            className={styles.input}
            type="number"
            min={5}
            value={every}
            onChange={(e) => setEvery(Number(e.target.value))}
            aria-label="Minutes between runs"
          />
        )}
      </div>
      <textarea
        className={styles.textarea}
        placeholder="What each run should do, e.g. Summarise anything important in my inbox"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        required
      />
      <div className={styles.actions}>
        <span className={styles.meta}>Times are in {timezone}.</span>
        <Button size="sm" variant="primary" type="submit" loading={create.isPending}>
          Add routine
        </Button>
      </div>
    </form>
  );
}
