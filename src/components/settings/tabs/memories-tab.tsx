"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, HoldToConfirm, SettingSection, useToast } from "@/components/ui";
import { api, fmtTime } from "./shared";
import styles from "./automation.module.css";

interface Memory {
  id: string;
  kind: "fact" | "preference" | "project";
  text: string;
  createdAt: string;
}

/** Settings → Memories: list, search, add, edit, delete long-term memories. */
export function MemoriesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const list = useQuery({
    queryKey: ["memories", q],
    queryFn: () => api<{ memories: Memory[] }>(`/api/memories${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["memories"] });
  const onError = (e: Error) => toast.push({ title: "Memory action failed", message: e.message, tone: "error" });

  const add = useMutation({
    mutationFn: () => api<{ duplicate: boolean }>("/api/memories", { method: "POST", body: { text: draft } }),
    onSuccess: (d) => {
      if (d.duplicate) toast.push({ title: "Already remembered", tone: "info" });
      setDraft("");
      refresh();
    },
    onError,
  });
  const save = useMutation({
    mutationFn: (v: { id: string; text: string }) => api(`/api/memories/${v.id}`, { method: "PATCH", body: { text: v.text } }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/memories/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError,
  });

  return (
    <div className={styles.stack}>
      <SettingSection title="Memories">
        <div className={styles.form}>
          <input className={styles.input} type="search" placeholder="Search memories" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search memories" />
        </div>
        <div className={styles.list}>
          {list.isPending && <div className={styles.empty}>Loading…</div>}
          {list.error && <div className={styles.error}>{list.error.message}</div>}
          {list.data?.memories.length === 0 && (
            <div className={styles.empty}>Nothing remembered yet. Facts are extracted after finished runs when a model key exists.</div>
          )}
          {list.data?.memories.map((m) => (
            <div className={styles.item} key={m.id}>
              <div>
                {editing?.id === m.id ? (
                  <textarea
                    className={styles.textarea}
                    value={editing.text}
                    onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                    aria-label="Edit memory"
                  />
                ) : (
                  <div className={styles.itemTitle}>{m.text}</div>
                )}
                <div className={styles.meta}>
                  {m.kind} · {fmtTime(m.createdAt)}
                </div>
              </div>
              <div className={styles.actions}>
                {editing?.id === m.id ? (
                  <>
                    <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate(editing)}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ id: m.id, text: m.text })}>
                    Edit
                  </Button>
                )}
                <HoldToConfirm size="sm" tone="danger" onConfirm={() => remove.mutate(m.id)}>
                  Forget
                </HoldToConfirm>
              </div>
            </div>
          ))}
        </div>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <div className={styles.formRow}>
            <input className={styles.input} placeholder="Add a memory, e.g. I prefer metric units" value={draft} onChange={(e) => setDraft(e.target.value)} minLength={3} required />
            <Button size="sm" variant="primary" type="submit" loading={add.isPending}>
              Remember
            </Button>
          </div>
        </form>
      </SettingSection>
    </div>
  );
}
