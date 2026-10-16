"use client";

import { CHAT_MODES, CHAT_MODE_META } from "@/lib/chat-mode";
import type { ChatMode } from "@/lib/chat-mode";
import { cn } from "@/lib/cn";
import styles from "./modes.module.css";

/** Per-chat conversation mode (persisted on the chat by the caller). */
export function ModeSelect({
  value,
  onChange,
  thinkingSupported = true,
}: {
  value: ChatMode;
  onChange: (mode: ChatMode) => void;
  /** False when the selected model cannot do extended thinking. */
  thinkingSupported?: boolean;
}) {
  return (
    <select
      className={cn(styles.mode, value === "debug" && styles.modeDebug)}
      value={value}
      aria-label="Conversation mode"
      title={CHAT_MODE_META[value].hint}
      onChange={(e) => onChange(e.target.value as ChatMode)}
    >
      {CHAT_MODES.map((m) => (
        <option key={m} value={m}>
          {CHAT_MODE_META[m].label}
          {m === "thinking" && !thinkingSupported ? " (not on this model)" : ""}
          {m === "debug" ? " (owner)" : ""}
        </option>
      ))}
    </select>
  );
}
