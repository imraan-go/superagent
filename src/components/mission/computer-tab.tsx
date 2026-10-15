"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  ArrowsIn,
  ArrowsOut,
  ArrowSquareOut,
  ArrowClockwise,
  Cursor,
  Monitor,
} from "@phosphor-icons/react/dist/ssr";
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
 * Take control removes it. A cross-origin frame cannot report its own state, so
 * the sign-in affordance is explicit rather than detected.
 */
export const OPEN_COMPUTER_EVENT = "lhos:open-computer";
/** Unused for this long (tab hidden, collapsed) and the iframe is unmounted. */
const UNMOUNT_AFTER_MS = 10 * 60 * 1000;
const SIGNED_IN_KEY = "lhos.vnc.connected";

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

const noopSubscribe = () => () => undefined;

function readSignedIn(): boolean {
  try {
    return window.localStorage.getItem(SIGNED_IN_KEY) === "1";
  } catch {
    return false;
  }
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
  const [connectedNow, setConnectedNow] = useState(false);
  const storedSignedIn = useSyncExternalStore(noopSubscribe, readSignedIn, () => false);
  const signedIn = storedSignedIn || connectedNow;
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

  /* ---- sign-in popup ---- */
  const connect = () => {
    if (!viewer) return;
    const popup = window.open(viewer.url, "lhos-vnc-signin", "popup,width=520,height=760");
    if (!popup) {
      toast.push({ title: "Popup blocked", message: "Allow popups, or use Open in a new tab.", tone: "warning" });
      return;
    }
    const poll = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(poll);
      try {
        window.localStorage.setItem(SIGNED_IN_KEY, "1");
      } catch {
        /* storage blocked: the reload below still happens */
      }
      setConnectedNow(true);
      setFrameKey((k) => k + 1);
    }, 800);
  };

  /* ---- wake ---- */
  const [jobId, setJobId] = useState<string | null>(null);
  const wake = useMutation({
    mutationFn: api.wakeComputer,
    onSuccess: ({ job }) => setJobId(job.id),
    onError: (err: Error) => toast.push({ title: "Could not wake the computer", message: err.message, tone: "error" }),
  });
  const { data: jobData } = useQuery({
    queryKey: ["computer", "job", jobId],
    queryFn: async () => {
      const result = await api.computerJob(jobId ?? "");
      if (result.job.ended) {
        void queryClient.invalidateQueries({ queryKey: ["lhos", "capabilities"] });
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
  const embeddable = viewer?.embeddable !== false;
  const showFrame = mounted && up && viewer && embeddable;
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
        actions={
          showFrame ? (
            <>
              <IconButton
                label="Reload live view"
                icon={<ArrowClockwise size={15} />}
                onClick={() => setFrameKey((k) => k + 1)}
              />
              <IconButton
                label="Open viewer in a new tab"
                icon={<ArrowSquareOut size={15} />}
                onClick={() => window.open(viewer.url, "_blank", "noopener,noreferrer")}
              />
            </>
          ) : undefined
        }
      >
        {/* The placeholder keeps the card's height while the stage is a sheet. */}
        <div className={styles.slot} data-expanded={expanded}>
          {!up || !embeddable ? (
            <Fallback
              reachable={capabilities?.reachable === true}
              asleep={asleep}
              waking={waking || capabilities?.waking === true}
              reason={!embeddable ? (viewer?.reason ?? null) : null}
              onWake={() => wake.mutate()}
              onOpen={viewer ? () => window.open(viewer.url, "_blank", "noopener,noreferrer") : undefined}
            />
          ) : (
            <motion.div
              layout
              transition={transition}
              className={cn(
                styles.stage,
                expanded && styles.sheet,
                control && styles.control,
              )}
              role={expanded ? "dialog" : undefined}
              aria-label={expanded ? "Agent computer, full view" : undefined}
              style={{ borderRadius: expanded ? 16 : 12 }}
            >
              <div className={styles.bar}>
                {control ? (
                  <>
                    <span className={styles.live} role="status">
                      <Dot status="warn" size="sm" pulse /> LIVE CONTROL
                      <span className={styles.timer}>{formatClock(controlSeconds)}</span>
                    </span>
                    <span className={styles.hint}>Esc to release</span>
                    <Button size="sm" variant="outline" onClick={release}>
                      Release
                    </Button>
                  </>
                ) : (
                  <>
                    <span className={styles.watch}>
                      <Dot status="live" size="sm" /> Watching
                    </span>
                    {takeoverAsked && <span className={styles.ask}>The agent asked you to take over</span>}
                    <HoldToConfirm
                      size="sm"
                      holdMs={600}
                      icon={<Cursor size={14} />}
                      onConfirm={takeControl}
                      disabled={!showFrame}
                      label="Take control of the agent computer"
                    >
                      Take control
                    </HoldToConfirm>
                  </>
                )}
                <IconButton
                  label={expanded ? "Collapse view" : "Expand view"}
                  icon={expanded ? <ArrowsIn size={15} /> : <ArrowsOut size={15} />}
                  onClick={() => setExpanded((v) => !v)}
                />
              </div>

              <div className={styles.frameWrap}>
                {showFrame ? (
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
                {!control && showFrame && <div className={styles.overlay} title="Watch only. Take control to interact." />}
              </div>
            </motion.div>
          )}
        </div>

        {up && embeddable && (
          <div className={styles.footer}>
            <Button size="sm" variant={signedIn ? "ghost" : "primary"} onClick={connect}>
              {signedIn ? "Reconnect view" : "Connect computer view"}
            </Button>
            <p className={styles.caption}>
              {signedIn
                ? "Blank or asking for a code? Reconnect to sign in again."
                : "Sign in to the viewer once with your access code."}
            </p>
          </div>
        )}
      </Panel>
    </>
  );
}

function Fallback(props: {
  reachable: boolean;
  asleep: boolean;
  waking: boolean;
  reason: string | null;
  onWake: () => void;
  onOpen?: () => void;
}) {
  const label = !props.reachable
    ? "Cannot reach the agent computer"
    : props.waking
      ? "Waking the computer…"
      : props.asleep
        ? "Computer is asleep"
        : "Live view can't be embedded";

  return (
    <div className={styles.fallback} data-state={props.asleep ? "asleep" : "offline"}>
      <span className={styles.fallbackGlyph} aria-hidden>
        <Monitor size={32} weight="duotone" />
      </span>
      <p className={styles.fallbackLabel}>{label}</p>
      {props.reason && !props.asleep && <p className={styles.fallbackReason}>{props.reason}</p>}
      {props.asleep && (
        <Button size="sm" variant="outline" loading={props.waking} onClick={props.onWake}>
          Wake
        </Button>
      )}
      {props.reason && !props.asleep && props.reachable && props.onOpen && (
        <Button size="sm" variant="primary" onClick={props.onOpen} iconRight={<ArrowSquareOut size={14} />}>
          Open the viewer
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
