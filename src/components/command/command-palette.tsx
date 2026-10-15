"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ChatCircleDots,
  Gauge,
  Gear,
  Keyboard,
  Monitor,
  PencilSimple,
  Plus,
  Robot,
  Sun,
} from "@phosphor-icons/react/dist/ssr";
import { Modal } from "@/components/ui";
import { SETTINGS_TAB_LIST } from "@/components/settings/settings-modal";
import { MANAGE_SECTION_LIST } from "@/components/manage/manage-view";
import { useNewChat } from "@/hooks/use-new-chat";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import { focusPrompt, openSettings, requestManageSection } from "@/lib/app-events";
import { cn } from "@/lib/cn";
import { fuzzyScore } from "@/lib/hotkeys";
import { OPEN_COMPUTER_EVENT } from "@/lib/hitl";
import { resolvedTheme } from "@/lib/theme";
import styles from "./command-palette.module.css";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ComponentType<{ size?: number; weight?: "duotone"; "aria-hidden"?: boolean }>;
  run: () => void;
}

const GROUP_ORDER = ["Actions", "Navigate", "Recent chats", "Settings", "Manage"];

export function CommandPalette({
  open,
  onClose,
  onShowShortcuts,
}: {
  open: boolean;
  onClose: () => void;
  onShowShortcuts: () => void;
}) {
  const router = useRouter();
  const newChat = useNewChat();
  const { theme, setTheme } = useTheme();
  const { data } = useQuery({ queryKey: ["chats"], queryFn: api.listChats, enabled: open });

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setActive(0);
    }
  }
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const commands = useMemo<Command[]>(() => {
    const go = (fn: () => void) => () => {
      onClose();
      fn();
    };
    const list: Command[] = [
      { id: "new-chat", group: "Actions", label: "New chat", hint: "⌘J", icon: Plus, run: go(() => newChat.mutate()) },
      {
        id: "focus-prompt",
        group: "Actions",
        label: "Focus prompt",
        hint: "⌘/",
        icon: PencilSimple,
        // After the dialog closes so focus lands in the prompt, not the restore target.
        run: go(() => setTimeout(focusPrompt, 0)),
      },
      {
        id: "theme",
        group: "Actions",
        label: "Toggle theme",
        // Static on purpose: a theme-dependent hint differs between SSR and the client (React #418).
        hint: "light ⇄ dark",
        icon: Sun,
        run: go(() => setTheme(resolvedTheme(theme) === "dark" ? "light" : "dark")),
      },
      {
        id: "computer",
        group: "Actions",
        label: "Open Computer",
        hint: "expand the agent screen",
        icon: Monitor,
        run: go(() => window.dispatchEvent(new CustomEvent(OPEN_COMPUTER_EVENT))),
      },
      { id: "shortcuts", group: "Actions", label: "Keyboard shortcuts", hint: "?", icon: Keyboard, run: go(onShowShortcuts) },
      { id: "go-agent", group: "Navigate", label: "Switch to Agent", hint: "g a", icon: Robot, run: go(() => router.push("/")) },
      { id: "go-manage", group: "Navigate", label: "Switch to Manage", hint: "g m", icon: Gauge, run: go(() => router.push("/manage")) },
    ];
    for (const chat of (data?.chats ?? []).slice(0, 15)) {
      list.push({
        id: `chat:${chat.id}`,
        group: "Recent chats",
        label: chat.title || "Untitled chat",
        icon: ChatCircleDots,
        run: go(() => router.push(`/chat/${chat.id}`)),
      });
    }
    for (const tab of SETTINGS_TAB_LIST) {
      list.push({
        id: `settings:${tab.id}`,
        group: "Settings",
        label: `Settings: ${tab.label}`,
        icon: Gear,
        run: go(() => openSettings(tab.id)),
      });
    }
    for (const section of MANAGE_SECTION_LIST) {
      list.push({
        id: `manage:${section.id}`,
        group: "Manage",
        label: `Manage: ${section.label}`,
        icon: Gauge,
        run: go(() => {
          requestManageSection(section.id);
          router.push("/manage");
        }),
      });
    }
    return list;
    // `newChat.mutate` is stable; recompute on data/theme changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.chats, theme, router, onClose, onShowShortcuts, setTheme]);

  const results = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, score: fuzzyScore(query, `${c.group} ${c.label}`) }))
      .filter((r) => r.score > 0);
    const q = query.trim();
    scored.sort((a, b) => {
      const ga = GROUP_ORDER.indexOf(a.c.group);
      const gb = GROUP_ORDER.indexOf(b.c.group);
      // Searching ranks purely by score; browsing keeps the group order.
      return q ? b.score - a.score : ga - gb;
    });
    return scored.map((r) => r.c);
  }, [commands, query]);

  // Reset on every open; focus after the dialog is actually shown.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const clamped = Math.min(active, Math.max(results.length - 1, 0));
  const activeId = results[clamped] ? `${listId}-${clamped}` : undefined;

  useEffect(() => {
    document.getElementById(activeId ?? "")?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((clamped + 1) % Math.max(results.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((clamped - 1 + results.length) % Math.max(results.length, 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(results.length - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[clamped]?.run();
    }
  };

  let lastGroup = "";
  return (
    <Modal open={open} onClose={onClose} title="Command palette" bodyFlush className={styles.palette}>
      <div className={styles.searchRow}>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label="Search commands, chats and settings"
          placeholder="Type a command, chat or setting…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>

      <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className={styles.list}>
        {results.map((cmd, i) => {
          const showGroup = !query.trim() && cmd.group !== lastGroup;
          lastGroup = cmd.group;
          const Icon = cmd.icon;
          return (
            <li key={cmd.id} role="presentation">
              {showGroup && <p className={styles.group}>{cmd.group}</p>}
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === clamped}
                className={cn(styles.option, i === clamped && styles.optionActive)}
                onMouseMove={() => i !== clamped && setActive(i)}
                onClick={cmd.run}
              >
                <Icon size={16} weight="duotone" aria-hidden />
                <span className={styles.label}>{cmd.label}</span>
                {cmd.hint && <span className={styles.hint}>{cmd.hint}</span>}
              </div>
            </li>
          );
        })}
      </ul>

      {results.length === 0 && <p className={styles.empty}>No matches.</p>}
      <p className={styles.srOnly} role="status" aria-live="polite">
        {results.length} {results.length === 1 ? "result" : "results"}
      </p>
    </Modal>
  );
}
