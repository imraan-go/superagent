"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowCounterClockwise, Broom, ShieldCheck, Trash } from "@phosphor-icons/react/dist/ssr";
import { Button, Dot, HoldToConfirm, Panel, Readout, useToast } from "@/components/ui";
import {
  canPreview,
  canPurge,
  canQuarantine,
  canRestore,
  clampKeep,
  evaluateVerify,
  formatGb,
  KEEP_DEFAULT,
  KEEP_MAX,
  KEEP_MIN,
} from "@/lib/manage/snapshot-cleanup";
import type { CleanupPlan, Quarantine, QuarantineResult } from "@/lib/manage/snapshot-cleanup";
import { apiGet, apiPost, ManageApiError } from "./api";
import type { Desktop, ServiceRow, Stats } from "./api";
import { formatWhen, SkeletonRows } from "./shared";
import styles from "./shared.module.css";

type VerifyState =
  | { state: "idle" }
  | { state: "running"; message: string }
  | { state: "ok"; message: string }
  | { state: "failed"; message: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A bridge refusal (409) is shown verbatim; other failures use the generic message. */
function Refusal({ error }: { error: unknown }) {
  const e = error instanceof ManageApiError ? error : null;
  const refused = e?.code === "conflict";
  return (
    <div className={styles.errorNote} role="alert">
      <strong>{refused ? "The bridge refused this plan" : "Request failed"}</strong>
      <div className={styles.mono}>{e?.message ?? (error instanceof Error ? error.message : String(error))}</div>
      {refused && <div>Nothing was changed. No delete path exists that bypasses this check.</div>}
    </div>
  );
}

const fetchStats = async () => (await apiGet<{ stats: Stats }>("/api/manage/stats")).stats;

export function CleanupPanel({ onPlan }: { onPlan: (plan: CleanupPlan | undefined) => void }) {
  const toast = useToast();
  const qc = useQueryClient();

  const [keep, setKeep] = useState(KEEP_DEFAULT);
  const [plan, setPlan] = useState<CleanupPlan | undefined>();
  const [planKeep, setPlanKeep] = useState<number | null>(null);
  const [verify, setVerify] = useState<VerifyState>({ state: "idle" });
  const [diskBefore, setDiskBefore] = useState<number | null>(null);
  const [diskAfterNote, setDiskAfterNote] = useState<string | null>(null);

  const stats = useQuery({ queryKey: ["manage", "cleanup-stats"], queryFn: fetchStats, refetchInterval: 15_000 });
  const quarantines = useQuery({
    queryKey: ["manage", "snapshot-quarantines"],
    queryFn: async () => (await apiGet<{ quarantines: Quarantine[] }>("/api/manage/snapshots/quarantines")).quarantines,
  });

  const refreshAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["manage", "snapshots"] });
    void qc.invalidateQueries({ queryKey: ["manage", "snapshot-quarantines"] });
    void qc.invalidateQueries({ queryKey: ["manage", "cleanup-stats"] });
    void qc.invalidateQueries({ queryKey: ["manage", "audit"] });
  }, [qc]);

  const setPlanBoth = useCallback(
    (p: CleanupPlan | undefined, k: number | null) => {
      setPlan(p);
      setPlanKeep(k);
      onPlan(p);
    },
    [onPlan],
  );

  const preview = useMutation({
    mutationFn: (k: number) => apiGet<CleanupPlan>(`/api/manage/snapshots/plan?keep=${k}`),
    onSuccess: (p, k) => {
      setPlanBoth(p, k);
      setDiskBefore(stats.data?.diskFree ?? null);
      setDiskAfterNote(null);
    },
    onError: () => setPlanBoth(undefined, null),
  });

  const quarantine = useMutation({
    mutationFn: (k: number) => apiPost<QuarantineResult>("/api/manage/snapshots/quarantine", { keep: k }),
    onSuccess: (r) => {
      setPlanBoth(undefined, null);
      setVerify({ state: "idle" });
      toast.push({
        title: r.quarantine ? "Moved to quarantine" : "Nothing to move",
        message: r.quarantine
          ? `${r.moved} builds, ${formatGb(r.bytes)}. Disk is not freed until you delete permanently.`
          : undefined,
        tone: "success",
        durationMs: 8000,
      });
      refreshAll();
    },
    onError: (e) => toast.push({ title: "Quarantine refused", message: e.message, tone: "error", durationMs: 10000 }),
  });

  const restore = useMutation({
    mutationFn: (name: string) => apiPost<{ restored: number }>(`/api/manage/snapshots/quarantines/${name}/restore`),
    onSuccess: (r) => {
      setVerify({ state: "idle" });
      toast.push({ title: "Restored", message: `${r.restored} builds put back.`, tone: "success" });
      refreshAll();
    },
    onError: (e) => toast.push({ title: "Restore failed", message: e.message, tone: "error", durationMs: 10000 }),
  });

  const purge = useMutation({
    mutationFn: (name: string) => {
      setDiskBefore(stats.data?.diskFree ?? null);
      return apiPost<{ purged: string; freedBytes: number }>(`/api/manage/snapshots/quarantines/${name}/purge`, {
        confirm: "DELETE",
      });
    },
    onSuccess: (r) => {
      setDiskAfterNote(`Freed ${formatGb(r.freedBytes)}.`);
      toast.push({ title: "Deleted permanently", message: `Freed ${formatGb(r.freedBytes)}.`, tone: "success", durationMs: 8000 });
      refreshAll();
    },
    onError: (e) => toast.push({ title: "Delete refused", message: e.message, tone: "error", durationMs: 10000 }),
  });

  /* Verify desktop: restart e2b-desktop-vnc, then poll until it is active and the desktop endpoint agrees. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const runVerify = useCallback(async () => {
    setVerify({ state: "running", message: "Restarting e2b-desktop-vnc…" });
    try {
      const unit = (rows: ServiceRow[]) => rows.find((s) => s.unit === "e2b-desktop-vnc");
      const before = unit((await apiGet<{ services: ServiceRow[] }>("/api/manage/services")).services);
      await apiPost("/api/manage/services/e2b-desktop-vnc/restart");
      const t0 = Date.now();
      for (;;) {
        await sleep(3000);
        if (!alive.current) return;
        const svc = unit((await apiGet<{ services: ServiceRow[] }>("/api/manage/services")).services);
        const desk = (await apiGet<{ desktop: Desktop }>("/api/manage/desktop")).desktop;
        const out = evaluateVerify({
          sinceBefore: before?.since ?? null,
          since: svc?.since ?? null,
          active: svc?.active ?? null,
          desktopService: desk.service ?? null,
          elapsedMs: Date.now() - t0,
        });
        if (out.state === "ok") {
          setVerify({
            state: "ok",
            message: `Desktop service is active${desk.sandbox_id ? ` (sandbox ${desk.sandbox_id})` : ""}.`,
          });
          return;
        }
        if (out.state === "failed") {
          setVerify({ state: "failed", message: out.reason });
          return;
        }
        setVerify({ state: "running", message: `Waiting for e2b-desktop-vnc (${svc?.active ?? "?"})…` });
      }
    } catch (e) {
      if (alive.current) setVerify({ state: "failed", message: e instanceof Error ? e.message : "Verification failed." });
    }
  }, []);

  const busy =
    preview.isPending || quarantine.isPending || restore.isPending || purge.isPending || verify.state === "running";
  const state = { keep, planKeep, plan, busy };
  const free = stats.data?.diskFree;

  return (
    <Panel title="Cleanup">
      <p className={styles.meta} style={{ margin: "0 0 var(--sp-4)" }}>
        Removes snapshot builds that nothing needs. The host bridge decides what is safe (newest desktop snapshots, the
        latest good template builds, every layer they depend on, and anything in-flight or under 6 hours old). Removal is
        two-step: builds are first moved to a quarantine (reversible, frees nothing), then deleted permanently after you
        verify the desktop.
      </p>

      <div className={styles.row} style={{ alignItems: "end", flexWrap: "wrap" }}>
        <div className={styles.label} role="group" aria-label="Keep newest desktop snapshots">
          Keep newest desktop snapshots
          <div className={styles.row}>
            <Button
              size="sm"
              variant="outline"
              aria-label="Fewer"
              disabled={keep <= KEEP_MIN}
              onClick={() => setKeep(clampKeep(keep - 1))}
            >
              −
            </Button>
            <input
              className={`${styles.input} ${styles.monoInput}`}
              style={{ width: 64, textAlign: "center" }}
              type="number"
              min={KEEP_MIN}
              max={KEEP_MAX}
              value={keep}
              aria-label="Number of desktop snapshots to keep"
              onChange={(e) => setKeep(clampKeep(Number(e.target.value)))}
            />
            <Button
              size="sm"
              variant="outline"
              aria-label="More"
              disabled={keep >= KEEP_MAX}
              onClick={() => setKeep(clampKeep(keep + 1))}
            >
              +
            </Button>
          </div>
        </div>
        <Button
          variant="primary"
          iconLeft={<Broom size={14} />}
          loading={preview.isPending}
          disabled={!canPreview(state)}
          onClick={() => preview.mutate(keep)}
        >
          Preview
        </Button>
        {free !== undefined && <Readout label="disk free" value={free / 1024 ** 3} unit="GB" precision={1} size="sm" />}
      </div>

      {preview.isError && (
        <div style={{ marginTop: "var(--sp-3)" }}>
          <Refusal error={preview.error} />
        </div>
      )}

      {plan && (
        <div style={{ marginTop: "var(--sp-4)" }}>
          <div className={styles.readouts}>
            <Readout label="to remove" value={plan.delete.length} size="sm" tone={plan.delete.length ? "amber" : "ok"} />
            <Readout label="reclaimable" value={plan.deleteBytes / 1024 ** 3} unit="GB" precision={2} size="sm" />
            <Readout label="kept builds" value={plan.keepCount} size="sm" />
            <Readout label="kept size" value={plan.keepBytes / 1024 ** 3} unit="GB" precision={2} size="sm" />
          </div>
          {plan.missingRoots.length > 0 && (
            <p className={styles.meta}>Roots missing on disk: {plan.missingRoots.join(", ")}</p>
          )}
          {plan.delete.length === 0 ? (
            <p className={styles.empty}>Nothing is safe to remove right now. Older builds are all in use or too recent.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Will be quarantined</th>
                    <th>Status</th>
                    <th>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.delete.map((d) => (
                    <tr key={d.id}>
                      <td className={styles.mono}>{d.id}</td>
                      <td>{d.status}</td>
                      <td className={styles.mono}>{formatGb(d.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details style={{ marginTop: "var(--sp-3)" }}>
            <summary className={styles.meta}>Kept roots ({plan.roots.length})</summary>
            <ul className={styles.mono} style={{ margin: "var(--sp-2) 0", paddingLeft: "var(--sp-5)" }}>
              {plan.roots.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
          <div className={styles.row} style={{ marginTop: "var(--sp-3)" }}>
            <HoldToConfirm
              tone="attention"
              icon={<Broom size={14} />}
              disabled={!canQuarantine(state)}
              onConfirm={() => quarantine.mutate(keep)}
            >
              Move to quarantine
            </HoldToConfirm>
            {planKeep !== null && planKeep !== keep && (
              <span className={styles.meta}>Keep changed. Run Preview again.</span>
            )}
          </div>
        </div>
      )}

      {diskBefore !== null && free !== undefined && diskAfterNote && (
        <p className={styles.meta}>
          Disk free: {formatGb(diskBefore)} to {formatGb(free)}. {diskAfterNote}
        </p>
      )}

      <h3 className={styles.sectionTitle}>Quarantine</h3>
      {quarantines.isPending && <SkeletonRows rows={1} height={60} />}
      {quarantines.isError && <Refusal error={quarantines.error} />}
      {quarantines.data && quarantines.data.length === 0 && <p className={styles.empty}>No quarantined snapshots.</p>}
      {quarantines.data?.map((q) => (
        <QuarantineCard
          key={q.name}
          q={q}
          verify={verify}
          busy={busy}
          onVerify={() => void runVerify()}
          onRestore={() => restore.mutate(q.name)}
          onPurge={() => purge.mutate(q.name)}
        />
      ))}
    </Panel>
  );
}

function QuarantineCard({
  q,
  verify,
  busy,
  onVerify,
  onRestore,
  onPurge,
}: {
  q: Quarantine;
  verify: VerifyState;
  busy: boolean;
  onVerify: () => void;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [override, setOverride] = useState(false);
  const verified = verify.state === "ok";
  const purgeOk = canPurge({ verified, override, typed, busy });

  return (
    <div className={styles.confirmBox} style={{ marginBottom: "var(--sp-3)" }}>
      <div className={styles.rowBetween}>
        <strong className={styles.mono}>{q.name}</strong>
        <span className={styles.meta} style={{ margin: 0 }}>
          {q.builds} builds · {formatGb(q.bytes)} · {formatWhen(new Date(q.created * 1000).toISOString())}
        </span>
      </div>
      <div>
        These builds are moved aside, not deleted, so no disk is freed yet. Verify the desktop still starts, then delete
        permanently. If anything looks wrong, restore.
      </div>

      <div className={styles.row} style={{ flexWrap: "wrap" }}>
        <Button
          size="sm"
          variant="outline"
          iconLeft={<ShieldCheck size={14} />}
          loading={verify.state === "running"}
          disabled={busy}
          onClick={onVerify}
        >
          Verify desktop
        </Button>
        <Button
          size="sm"
          variant="outline"
          iconLeft={<ArrowCounterClockwise size={14} />}
          disabled={!canRestore({ busy })}
          onClick={onRestore}
        >
          Restore
        </Button>
      </div>
      {verify.state !== "idle" && (
        <div role="status" className={styles.cell}>
          <Dot status={verify.state === "ok" ? "ok" : verify.state === "failed" ? "error" : "pending"} size="sm" />
          {verify.message}
        </div>
      )}
      {verify.state === "failed" && <div>Do not delete. Use Restore, then check the desktop.</div>}

      <label className={styles.check}>
        <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />I verified manually
        (skip the in-panel check)
      </label>
      <label className={styles.label}>
        Type DELETE to enable permanent deletion
        <input
          className={`${styles.input} ${styles.monoInput}`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div>
        <HoldToConfirm tone="danger" icon={<Trash size={14} />} disabled={!purgeOk} onConfirm={onPurge}>
          Delete permanently
        </HoldToConfirm>
        {!verified && !override && <span className={styles.meta}> Run Verify desktop (or tick the box) first.</span>}
      </div>
    </div>
  );
}
