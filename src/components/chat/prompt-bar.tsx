"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  CalendarPlus,
  Paperclip, 
  Plus,
  Sparkle,
  Square,
} from "@phosphor-icons/react/dist/ssr";
import { api } from "@/lib/api";
import { Button, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import styles from "./prompt-bar.module.css";

/**
 * The pill prompt bar: `+` menu on the left, model picker and send on the
 * right (DESIGN_SYSTEM §Reference reading).
 *
 * While a run is active the send button becomes Stop — the same position, so
 * the owner never hunts for it.
 */
export interface PromptBarProps {
  onSend: (text: string, model: string) => void;
  onStop: () => void;
  busy: boolean;
  disabled?: boolean;
}

const MAX_ROWS = 10;

export function PromptBar({ onSend, onStop, busy, disabled }: PromptBarProps) {
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({ queryKey: ["models"], queryFn: api.listModels });
  const models = data?.models.filter((m) => m.ready) ?? [];
  const selected = model ?? data?.defaultModel ?? "";

  // Grow with content up to a cap, then scroll.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = MAX_ROWS * 22;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [text]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const submit = () => {
    const value = text.trim();
    if (!value || busy || disabled) return;
    onSend(value, selected);
    setText("");
  };

  return (
    <div className={styles.wrap}>
      <div className={cn(styles.bar, disabled && styles.barDisabled)}>
        <div className={styles.menuAnchor} ref={menuRef}>
          <IconButton
            label="Add to this message"
            icon={<Plus size={16} weight="bold" />}
            pill
            active={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          />
          {menuOpen && (
            <div className={styles.menu} role="menu">
              {/* Phase 2 wires uploads; Phase 4 skills and schedules. */}
              <button type="button" role="menuitem" disabled>
                <Paperclip size={14} /> Attach files
              </button>
              <button type="button" role="menuitem" disabled>
                <Sparkle size={14} /> Save as skill
              </button>
              <button type="button" role="menuitem" disabled>
                <CalendarPlus size={14} /> Schedule this
              </button>
              <p className={styles.menuNote}>Arriving in a later phase.</p>
            </div>
          )}
        </div>

        <textarea
          ref={textareaRef}
          className={styles.input}
          value={text}
          rows={1}
          placeholder={disabled ? "Open or start a chat first" : "Tell the agent what to do"}
          aria-label="Message the agent"
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a newline.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />

        <div className={styles.right}>
          {models.length > 0 && (
            <select
              className={styles.model}
              value={selected}
              aria-label="Model"
              onChange={(e) => setModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          )}

          {busy ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onStop}
              iconLeft={<Square size={13} weight="fill" />}
            >
              Stop
            </Button>
          ) : (
            <IconButton
              label="Send"
              icon={<ArrowUp size={16} weight="bold" />}
              pill
              onClick={submit}
              disabled={!text.trim() || disabled}
            />
          )}
        </div>
      </div>

      {data && !data.anyVendorReady && (
        <p className={styles.hint}>
          No model key yet — running on the mock model. Add one in Settings → Models.
        </p>
      )}
    </div>
  );
}
