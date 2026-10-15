"use client";

import { useQuery } from "@tanstack/react-query";
import { Dot } from "@/components/ui";
import type { DotStatus } from "@/components/ui/dot";
import styles from "./connection-dot.module.css";

export interface CapabilitiesSnapshot {
  reachable: boolean;
  waking?: boolean;
  desktopUp?: boolean;
  sandboxId?: string | null;
  rdpConnected?: boolean;
  pace?: string | null;
  pendingHumanRequests?: number;
  message?: string;
  /** Raw LHOS capabilities document (passed through by the API route). */
  capabilities?: Record<string, unknown>;
  /** Last poll failed or timed out, but LHOS answered recently: it is busy running tools. */
  busy?: boolean;
}

/**
 * LHOS answers status slowly while it is executing tools (long browser waits,
 * shell commands). One slow/failed poll right after a good one means "busy",
 * not "offline": only report offline after BUSY_GRACE_MS without a success.
 */
const BUSY_GRACE_MS = 120_000;
let lastGood: { at: number; snap: CapabilitiesSnapshot } | null = null;

export async function fetchCapabilities(): Promise<CapabilitiesSnapshot> {
  let snap: CapabilitiesSnapshot | null = null;
  try {
    const res = await fetch("/api/lhos/capabilities", { cache: "no-store" });
    if (res.ok) snap = (await res.json()) as CapabilitiesSnapshot;
  } catch {
    // network blip — handled below
  }
  if (snap?.reachable) {
    lastGood = { at: Date.now(), snap };
    return snap;
  }
  if (!snap?.waking && lastGood && Date.now() - lastGood.at < BUSY_GRACE_MS) {
    return { ...lastGood.snap, busy: true };
  }
  if (!snap) throw new Error("capabilities unreachable");
  return snap;
}

/**
 * Live link state to the agent computer. Three things can be true and the dot
 * must distinguish them, because the owner's next action differs for each:
 * the panel cannot reach LHOS, LHOS is up but the desktop is asleep, or
 * everything is live.
 */
export function ConnectionDot() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["lhos", "capabilities"],
    queryFn: fetchCapabilities,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  const { status, text, title, pulse } = describe(data, isPending, isError);

  return (
    <span className={styles.wrap} title={title} data-status={status}>
      <Dot status={status} pulse={pulse} label={`Agent computer: ${text}`} />
      <span className={styles.text}>{text}</span>
    </span>
  );
}

function describe(
  data: CapabilitiesSnapshot | undefined,
  isPending: boolean,
  isError: boolean,
): { status: DotStatus; text: string; title: string; pulse: boolean } {
  if (isPending) {
    return { status: "pending", text: "Connecting", title: "Contacting the agent computer…", pulse: false };
  }

  if (isError || !data) {
    return { status: "error", text: "Offline", title: "The panel could not reach LHOS.", pulse: false };
  }

  if (data.busy) {
    return {
      status: "live",
      text: "Busy",
      title: "The agent computer is working; status refreshes when it is free.",
      pulse: true,
    };
  }

  if (!data.reachable) {
    return data.waking
      ? { status: "warn", text: "Waking", title: "The desktop is starting up.", pulse: true }
      : {
          status: "error",
          text: "Offline",
          title: data.message ?? "The agent computer is unreachable.",
          pulse: false,
        };
  }

  if (!data.desktopUp) {
    return {
      status: "warn",
      text: "Asleep",
      title: "LHOS is reachable but the desktop sandbox is down.",
      pulse: false,
    };
  }

  const parts = [`Sandbox ${data.sandboxId ?? "unknown"}`, `pace ${data.pace ?? "—"}`];
  if (data.rdpConnected) parts.push("RDP connected");

  return { status: "live", text: "Live", title: parts.join(" · "), pulse: true };
}
