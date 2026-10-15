"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  CalendarPlus,
  FileText,
  Gauge,
  Paperclip,
  Plus,
  Sparkle,
  Square,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { api } from "@/lib/api";
import { pickModel } from "@/lib/model-pick";
import { Button, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  ACCEPT_ATTRIBUTE,
  ALLOWED_EXTENSIONS,
  MAX_ATTACHMENTS,
  MAX_UPLOAD_BYTES,
  extensionOf,
  formatBytes,
  isImageMime,
} from "@/lib/uploads";
import type { FileInfo } from "@/lib/uploads";
import { CAPABILITIES, PROMPT_PREFILL_EVENT, SLASH_COMMANDS, matchSlash } from "./parts/composer";
import type { CapabilityId, PromptPrefillDetail, SlashCommand } from "./parts/composer";
import styles from "./prompt-bar.module.css";
import { CapabilityChips } from "./parts/capability-chips";
import { ModeSelect } from "./parts/mode-select";
import { DEFAULT_CHAT_PREFS } from "@/lib/chat-mode";
import type { ChatMode, ChatPrefs } from "@/lib/chat-mode";


interface LhosSnapshot {
  reachable?: boolean;
  pace?: string | null;
}

async function fetchLhos(): Promise<LhosSnapshot> {
  const res = await fetch("/api/lhos/capabilities", { cache: "no-store" });
  if (!res.ok) throw new Error(`capabilities: ${res.status}`);
  return (await res.json()) as LhosSnapshot;
}

/**
 * The pill prompt bar: `+` menu on the left, model picker and send on the
 * right (DESIGN_SYSTEM §Reference reading).
 *
 * While a run is active the send button becomes Stop — the same position, so
 * the owner never hunts for it.
 */
export interface SendOptions {
  mode: ChatMode;
  /** Auto chip: the server picks capabilities from the text. */
  capabilitiesAuto: boolean;
}

export interface PromptBarProps {
  onSend: (
    text: string,
    model: string,
    fileIds: string[],
    capabilities: CapabilityId[],
    options: SendOptions,
  ) => void;
  /** The chat's stored composer prefs (mode + Auto/manual chips). */
  initialPrefs?: ChatPrefs | null;
  /** Called when the owner changes mode or chips, to persist on the chat. */
  onPrefsChange?: (prefs: ChatPrefs) => void;
  /** What Auto picked for the current/last run. */
  autoPick?: { chosen: string[]; reasons: string[] } | null;
  /** Uploads are tied to the chat when known; the landing sends none. */
  chatId?: string | null;
  /** The chat's stored model; preselected so a reload does not switch vendors. */
  chatModel?: string | null;
  onStop: () => void;
  busy: boolean;
  disabled?: boolean;
}

const MAX_ROWS = 10;

interface Attachment {
  key: string;
  name: string;
  status: "uploading" | "done" | "error";
  file?: FileInfo;
  error?: string;
}

export function PromptBar({
  onSend,
  onStop,
  busy,
  disabled,
  chatId,
  chatModel,
  initialPrefs,
  onPrefsChange,
  autoPick,
}: PromptBarProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [caps, setCaps] = useState<CapabilityId[]>([]);
  const [capsAuto, setCapsAuto] = useState(true);
  const [mode, setMode] = useState<ChatMode>(DEFAULT_CHAT_PREFS.mode);
  // Adopt the chat's stored prefs once they load (and on chat switch).
  const prefsKey = initialPrefs ? JSON.stringify(initialPrefs) : null;
  const [adopted, setAdopted] = useState<string | null>(null);
  if (prefsKey && prefsKey !== adopted) {
    // Adjusting state while rendering (React docs: "storing information from previous renders").
    const p = JSON.parse(prefsKey) as ChatPrefs;
    setAdopted(prefsKey);
    setMode(p.mode);
    setCapsAuto(p.capsAuto);
    setCaps(p.caps as CapabilityId[]);
  }
  const savePrefs = (next: Partial<ChatPrefs>) =>
    onPrefsChange?.({ mode, capsAuto, caps, ...next });
  const [slashIdx, setSlashIdx] = useState(0);
  const slash = matchSlash(text);
  const slashOpen = slash.length > 0;
  const slashSel = slashOpen ? slashIdx % slash.length : 0;

  // Same cache key as the topbar dot, so this adds no polling of its own.
  const { data: lhosState } = useQuery({
    queryKey: ["lhos", "capabilities"],
    queryFn: fetchLhos,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
  const pace = lhosState?.reachable ? (lhosState.pace ?? null) : null;

  // Landing suggestions (and anything else) can prefill the composer.
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent<PromptPrefillDetail>).detail;
      if (!detail) return;
      setText(detail.text);
      if (detail.capabilities) {
        setCaps(detail.capabilities);
        setCapsAuto(false);
      }
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    };
    window.addEventListener(PROMPT_PREFILL_EVENT, onPrefill);
    return () => window.removeEventListener(PROMPT_PREFILL_EVENT, onPrefill);
  }, []);

  /** A specific chip switches to Manual (starting from an empty selection). */
  const toggleCap = (id: CapabilityId) => {
    const base = capsAuto ? [] : caps;
    const next = base.includes(id) ? base.filter((c) => c !== id) : [...base, id];
    setCaps(next);
    setCapsAuto(false);
    savePrefs({ caps: next, capsAuto: false });
  };
  const chooseAuto = () => {
    setCapsAuto(true);
    setCaps([]);
    savePrefs({ capsAuto: true, caps: [] });
  };
  const changeMode = (m: ChatMode) => {
    setMode(m);
    savePrefs({ mode: m });
  };

  const applySlash = (command: SlashCommand) => {
    setText(command.template);
    setSlashIdx(0);
    const cap = command.capability;
    if (cap) {
      setCaps((prev) => (capsAuto ? [cap] : prev.includes(cap) ? prev : [...prev, cap]));
      setCapsAuto(false);
    }
    textareaRef.current?.focus();
  };

  const { data } = useQuery({ queryKey: ["models"], queryFn: api.listModels });
  const models = data?.models.filter((m) => m.ready) ?? [];
  const selected = pickModel({
    chosen: model,
    chatModel: chatModel ?? null,
    defaultModel: data?.defaultModel ?? null,
    ready: models.map((m) => m.id),
  });

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

  const uploading = attachments.some((a) => a.status === "uploading");
  const ready = attachments.flatMap((a) => (a.status === "done" && a.file ? [a.file] : []));
  const canSend = (text.trim().length > 0 || ready.length > 0) && !uploading && !disabled;

  const addFiles = useCallback(
    (incoming: File[]) => {
      if (disabled || incoming.length === 0) return;
      const room = MAX_ATTACHMENTS - attachments.length;
      const batch = incoming.slice(0, Math.max(room, 0));
      if (incoming.length > batch.length) {
        setAttachments((prev) => [
          ...prev,
          {
            key: crypto.randomUUID(),
            name: "Too many files",
            status: "error",
            error: `Only ${MAX_ATTACHMENTS} files per message.`,
          },
        ]);
      }
      for (const file of batch) {
        const key = crypto.randomUUID();
        const ext = extensionOf(file.name || "");
        // Fast local feedback; the server re-checks everything.
        const localError = !ALLOWED_EXTENSIONS[ext]
          ? `.${ext || "?"} files are not accepted.`
          : file.size > MAX_UPLOAD_BYTES
            ? `Over the ${formatBytes(MAX_UPLOAD_BYTES)} limit.`
            : null;
        if (localError) {
          setAttachments((prev) => [
            ...prev,
            { key, name: file.name || "file", status: "error", error: localError },
          ]);
          continue;
        }
        setAttachments((prev) => [...prev, { key, name: file.name, status: "uploading" }]);
        api
          .uploadFile(file, chatId)
          .then(({ file: saved }) =>
            setAttachments((prev) =>
              prev.map((a) => (a.key === key ? { ...a, status: "done", file: saved } : a)),
            ),
          )
          .catch((err: Error) =>
            setAttachments((prev) =>
              prev.map((a) => (a.key === key ? { ...a, status: "error", error: err.message } : a)),
            ),
          );
      }
    },
    [attachments.length, chatId, disabled],
  );

  // Drag-and-drop anywhere on the page: the whole window is the drop zone.
  useEffect(() => {
    if (disabled) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [addFiles, disabled]);

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData.files);
    if (pasted.length === 0) return;
    e.preventDefault();
    addFiles(
      pasted.map((f) =>
        // Screenshots paste as "image.png"; keep names distinct.
        f.name && f.name !== "image.png"
          ? f
          : new File([f], `pasted-${Date.now()}.png`, { type: f.type }),
      ),
    );
  };

  const submit = () => {
    const value = text.trim();
    if (!canSend || busy) return;
    onSend(value, selected, ready.map((f) => f.id), capsAuto ? [] : caps, { mode, capabilitiesAuto: capsAuto });
    setText("");
    setAttachments([]);
  };

  return (
    <div className={styles.wrap}>
      {dragging && (
        <div className={styles.drop} aria-hidden>
          Drop files to attach
        </div>
      )}

      {attachments.length > 0 && (
        <ul className={styles.chips} aria-label="Attachments">
          {attachments.map((a) => (
            <li
              key={a.key}
              className={cn(styles.chip, a.status === "error" && styles.chipError)}
              title={a.error}
            >
              {a.file && isImageMime(a.file.mime) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/uploads/${a.file.id}`} alt="" className={styles.chipThumb} />
              ) : (
                <FileText size={14} aria-hidden />
              )}
              <span className={styles.chipName}>{a.name}</span>
              <span className={styles.chipMeta}>
                {a.status === "uploading"
                  ? "uploading..."
                  : a.status === "error"
                    ? a.error
                    : formatBytes(a.file?.bytes ?? 0)}
              </span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`Remove ${a.name}`}
                onClick={() => setAttachments((prev) => prev.filter((x) => x.key !== a.key))}
              >
                <X size={11} weight="bold" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        accept={ACCEPT_ATTRIBUTE}
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {slashOpen && (
        <ul className={styles.slash} id="fd-slash" role="listbox" aria-label="Commands">
          {slash.map((c, i) => (
            <li key={c.cmd} role="option" aria-selected={i === slashSel}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applySlash(c)}
              >
                <span className={styles.slashCmd}>{c.cmd}</span>
                <span className={styles.slashLabel}>{c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={cn(styles.bar, disabled && styles.barDisabled, busy && styles.barBusy)}>
        <textarea
          ref={textareaRef}
          data-prompt-input=""
          className={styles.input}
          value={text}
          rows={1}
          placeholder={disabled ? "Open or start a chat first" : "Tell the agent what to do — / for commands"}
          aria-label="Message the agent"
          aria-controls={slashOpen ? "fd-slash" : undefined}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            setSlashIdx(0);
          }}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (slashOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIdx(
                  (slashSel + (e.key === "ArrowDown" ? 1 : slash.length - 1)) % slash.length,
                );
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                const pick = slash[slashSel];
                if (pick) applySlash(pick);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setText("");
                return;
              }
            }
            // Enter or ⌘/Ctrl+Enter sends; Shift+Enter is a newline.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />

        <div className={styles.toolbar}>
          <div className={styles.menuAnchor} ref={menuRef}>
            <IconButton
              label="Add to this message"
              icon={<Plus size={16} weight="bold" />}
              pill
              size="sm"
              active={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            />
            {menuOpen && (
              <div className={styles.menu} role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={attachments.length >= MAX_ATTACHMENTS}
                  onClick={() => {
                    setMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <Paperclip size={14} /> Attach files
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    const cmd = SLASH_COMMANDS.find((c) => c.cmd === "/schedule");
                    if (cmd) applySlash(cmd);
                  }}
                >
                  <CalendarPlus size={14} /> Schedule this
                </button>
                <button type="button" role="menuitem" disabled>
                  <Sparkle size={14} /> Save as skill
                </button>
                <p className={styles.menuNote}>Skills arrive in a later phase.</p>
              </div>
            )}
          </div>

          <CapabilityChips
            auto={capsAuto}
            caps={caps}
            picked={autoPick?.chosen ?? []}
            pickedWhy={autoPick?.reasons}
            onAuto={chooseAuto}
            onToggle={toggleCap}
          />

          <div className={styles.right}>
            <ModeSelect
              value={mode}
              onChange={changeMode}
              thinkingSupported={models.find((m) => m.id === selected)?.vendor === "anthropic"}
            />
            {pace && (
              <span className={styles.pace} title="Agent pace (set in Manage)">
                <Gauge size={12} aria-hidden />
                {pace}
              </span>
            )}
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
                iconLeft={<Square size={12} weight="fill" />}
                className={styles.stop}
              >
                Stop
              </Button>
            ) : (
              <IconButton
                label="Send (Enter)"
                icon={<ArrowUp size={16} weight="bold" />}
                pill
                className={cn(styles.send, canSend && styles.sendReady)}
                onClick={submit}
                disabled={!canSend}
              />
            )}
          </div>
        </div>
      </div>

      <p className={styles.keys}>
        <span aria-hidden>
          <kbd>↵</kbd> send · <kbd>⇧↵</kbd> newline · <kbd>/</kbd> commands
        </span>
        {!capsAuto && caps.length > 0 && (
          <span className={styles.capNote}>
            Focused on {caps.map((id) => CAPABILITIES.find((c) => c.id === id)?.label).join(", ")}
          </span>
        )}
      </p>

      {data && !data.anyVendorReady && (
        <p className={styles.hint}>
          No model key yet — running on the mock model. Add one in Settings → Models.
        </p>
      )}
    </div>
  );
}
