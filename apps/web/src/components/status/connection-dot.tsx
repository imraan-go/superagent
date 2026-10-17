"use client";

import { Dot } from "@/components/ui";
import { STATE_LABEL, useCapabilities } from "@/hooks/use-capabilities";
import styles from "./connection-dot.module.css";

const TITLE = {
  checking: "Checking the server…",
  ready: "Ready: the worker is running and a model is configured.",
  working: "A run is in progress.",
  setup: "No model gateway is configured on the server (AI_GATEWAY_API_KEY, AI_MODEL_PRIMARY).",
  offline: "Runs are not starting: the Temporal worker is not draining its queue. Start it with `pnpm worker:dev`.",
} as const;

/** Topbar status: can a message start a run right now, and is one running? */
export function ConnectionDot() {
  const { state, dot } = useCapabilities();
  const text = STATE_LABEL[state];
  return (
    <span className={styles.wrap} title={TITLE[state]} data-status={dot}>
      <Dot status={dot} pulse={state === "working"} label={`Agent: ${text}`} />
      <span className={styles.text}>{text}</span>
    </span>
  );
}
