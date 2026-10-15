"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowsIn, ArrowsOut, ArrowClockwise, Cursor, Monitor } from "@phosphor-icons/react/dist/ssr";
import { Button, Dot, HoldToConfirm, IconButton, Panel, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { RunStepView } from "@/lib/run-events";
import styles from "./computer-tab.module.css";

/**
 * The live Computer panel (docs/skills/skill-vnc-embed.md).
 *
 * One iframe, never re-parented: "expand" animates the *same* element between
 * the card and a full-height sheet with a Motion layout transition, so the VNC
 * session does not reconnect. VNC traffic goes browser -> viewer directly; this
 * component only frames it.
 *
 * Watch mode lays a transparent overlay over the frame (input is swallowed);
 * Take control removes it. Sign-in happens INSIDE the frame: the viewer allows
 * this panel via CSP frame-ancestors and keeps a SameSite=Lax session cookie on
 * the shared site, so a signed-out viewer simply renders its access-code form
 * here (no popup). The frame is tall enough for that form; Reload re-fetches it.
 */
export const OPEN_COMPUTER_EVENT = "lhos:open-computer";
/** Unused for this long (tab hidden, collapsed) and the iframe is unmounted. */
const UNMOUNT_AFTER_MS = 10 * 60 * 1000;

export interface ComputerCapabilities {
  reachable: boolean;
  waking?: boolean;
  desktopUp?: boolean;
}

export interface ComputerTabProps {
  capabilities?: ComputerCapabilities;
  /** True while the Computer tab is the visible one. */
  active: boolean;
  steps: RunStepView[];
  runId: string | null;
  /** Ask the rail to switch to this tab. */
  onRequestOpen: () => void;
}

export function ComputerTab({ capabilities, active, steps, runId, onRequestOpen }: ComputerTabProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();

  const [expanded, setExpanded] = useState(false);
  const [control, setControl] = useState(false);
  const [controlSeconds, setControlSeconds] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [takeoverAsked, setTakeoverAsked] = useState(false);
  const controlStartRef = useRef(0);

  const { data: viewer } = useQuery({
    queryKey: ["computer", "viewer"],
    queryFn: api.computerViewer,
    staleTime: 5 * 60_000,
  });

  const up = capabilities?.reachable === true && capabilities.desktopUp === true;
  const asleep = capabilities?.reachable === true && !capabilities.desktopUp;
  const visible = active || expanded;

  /* ---- mount policy: lazy first mount, unmount after 10 idle minutes ---- */
  if (visible && !mounted) setMounted(true);
  useEffect(() => {
    if (visible || !mounted) return;
    const timer = window.setTimeout(() => {
      setMounted(false);
      setControl(false);
    }, UNMOUNT_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [visible, mounted]);

  // The sheet is position:fixed inside the tab, so hiding the tab must collapse it.
  if (!active && expanded) setExpanded(false);

  /* ---- take control / release ---- */
  const release = useCallback(() => {
    setControl((was) => {
      if (was) {
        const seconds = Math.round((Date.now() - controlStartRef.current) / 1000);
        void api.logTakeover("end", seconds).catch(() => undefined);
      }
      return false;
    });
  }, []);

  const takeControl = useCallback(() => {
    controlStartRef.current = Date.now();
    setControlSeconds(0);
    setControl(true);
    setTakeoverAsked(false);
    void api.logTakeover("start").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!control) return;
    const id = window.setInterval(
      () => setControlSeconds(Math.round((Date.now() - controlStartRef.current) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [control]);

  // Esc releases control first, then collapses the sheet. Keys typed *inside*
  // the frame belong to the remote desktop, so the Release button is always
  // visible as well.
  useEffect(() => {
    if (!control && !expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (control) release();
      else setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [control, expanded, release]);

  /* ---- open requests: approvals engineer's event + request_takeover step ---- */
  const openForTakeover = useCallback(() => {
    onRequestOpen();
    setTakeoverAsked(true);
    setExpanded(true);
  }, [onRequestOpen]);

  useEffect(() => {
    const handler = () => openForTakeover();
    window.addEventListener(OPEN_COMPUTER_EVENT, handler);
    return () => window.removeEventListener(OPEN_COMPUTER_EVENT, handler);
  }, [openForTakeover]);

  const handledRef = useRef<string>("");
  useEffect(() => {
    const step = steps.find((s) => s.toolName === "request_takeover");
    if (!step) return;
    const key = `${runId ?? ""}:${step.idx}`;
    if (handledRef.current === key) return;
    handledRef.current = key;
    openForTakeover();
  }, [steps, runId, openForTakeover]);

  /* ---- wake ---- */
  const [jobId, setJobId] = useState<string | null>(null);
  const wake = useMutation({
    mutationFn: api.wakeComputer,
    onSuccess: ({ job }) => setJobId(job.id),
    onError: (err: Error) =>
      toast.push({
        title: "Could not wake the computer",
        message: err.message,
        tone: "error",
      }),
  });
  const { data: jobData } = useQuery({
    queryKey: ["computer", "job", jobId],
    queryFn: async () => {
      const result = await api.computerJob(jobId ?? "");
      if (result.job.ended) {
        void queryClient.invalidateQueries({
          queryKey: ["lhos", "capabilities"],
        });
        if (result.job.ok === false) {
          toast.push({
            title: "Wake failed",
            message: result.job.output.slice(-200) || "The bridge reported an error.",
            tone: "error",
          });
        }
      }
      return result;
    },
    enabled: jobId !== null,
    refetchInterval: (q) => (q.state.data?.job.ended ? false : 2000),
  });
  const job = jobData?.job;
  const waking = jobId !== null && !job?.ended;

  /* ---- render ---- */
  const showFrame = Boolean(mounted && up && viewer);
  const reload = () => setFrameKey((k) => k + 1);
  const transition = reduced ? { duration: 0 } : { duration: 0.28, ease: [0.22, 0.61, 0.36, 1] as const };

  const status = !capabilities?.reachable ? "error" : up ? "live" : "warn";

  return (
    <>
      {expanded && (
        <motion.div
          className={styles.backdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={transition}
          onClick={() => !control && setExpanded(false)}
          aria-hidden
        />
      )}

      <Panel
        title="Screen"
        badge={<Dot status={status} size="sm" pulse={up} label={up ? "Desktop live" : undefined} />}
      >
        {/* The placeholder keeps the card's height while the stage is a sheet. */}
        <div className={styles.slot} data-expanded={expanded}>
          {!up ? (
            <Fallback
              reachable={capabilities?.reachable === true}
              asleep={asleep}
              waking={waking || capabilities?.waking === true}
              onWake={() => wake.mutate()}
            />
          ) : (
            <motion.div
              layout
              transition={transition}
              className={cn(styles.stage, expanded && styles.sheet, control && styles.control)}
              role={expanded ? "dialog" : undefined}
              aria-label={expanded ? "Agent computer, full view" : undefined}
              style={{ borderRadius: expanded ? 16 : 12 }}
            >
              <div className={styles.bar} role="toolbar" aria-label="Live view controls">
                <div className={styles.barLead}>
                  {control ? (
                    <>
                      <span className={styles.live} role="status">
                        <Dot status="warn" size="sm" pulse /> LIVE CONTROL
                        <span className={styles.timer}>{formatClock(controlSeconds)}</span>
                      </span>
                      <Button size="sm" variant="outline" onClick={release} title="Esc also releases">
                        Release
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className={styles.watch}>
                        <Dot status="live" size="sm" /> Watch
                      </span>
                      <HoldToConfirm
                        size="sm"
                        holdMs={600}
                        icon={<Cursor size={14} />}
                        onConfirm={takeControl}
                        disabled={!showFrame}
                        label="Take control of the agent computer (hold)"
                      >
                        Take control
                      </HoldToConfirm>
                    </>
                  )}
                </div>
                <div className={styles.barTail}>
                  <IconButton
                    label="Reload live view"
                    icon={<ArrowClockwise size={15} />}
                    onClick={reload}
                    disabled={!showFrame}
                  />
                  <IconButton
                    label={expanded ? "Collapse view" : "Expand view"}
                    icon={expanded ? <ArrowsIn size={15} /> : <ArrowsOut size={15} />}
                    onClick={() => setExpanded((v) => !v)}
                  />
                </div>
                {takeoverAsked && <p className={styles.ask}>The agent asked you to take over.</p>}
              </div>

              <div className={styles.frameWrap}>
                {showFrame && viewer ? (
                  <iframe
                    key={frameKey}
                    className={styles.frame}
                    src={viewer.url}
                    title="Agent computer live view"
                    allow="clipboard-read; clipboard-write; fullscreen"
                  />
                ) : (
                  <div className={styles.idle}>
                    <Monitor size={28} weight="duotone" />
                    <span>Live view paused</span>
                  </div>
                )}
                {!control && showFrame && (
                  <div className={styles.overlay} title="Watch only. Take control to interact." />
                )}
              </div>
            </motion.div>
          )}
        </div>

        {up && (
          <p className={styles.caption}>
            {viewer?.embeddable === false
              ? (viewer.reason ?? "The viewer may refuse to be framed here.")
              : "Signed out? Take control and type your access code in the frame. Blank? Reload."}
          </p>
        )}
      </Panel>
    </>
  );
}

function Fallback(props: { reachable: boolean; asleep: boolean; waking: boolean; onWake: () => void }) {
  const label = !props.reachable
    ? "Cannot reach the agent computer"
    : props.waking
      ? "Waking the computer…"
      : props.asleep
        ? "Computer is asleep"
        : "Desktop is starting";

  return (
    <div className={styles.fallback} data-state={props.asleep ? "asleep" : "offline"}>
      <span className={styles.fallbackGlyph} aria-hidden>
        <Monitor size={32} weight="duotone" />
      </span>
      <p className={styles.fallbackLabel}>{label}</p>
      {props.asleep && (
        <Button size="sm" variant="outline" loading={props.waking} onClick={props.onWake}>
          Wake
        </Button>
      )}
    </div>
  );
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
