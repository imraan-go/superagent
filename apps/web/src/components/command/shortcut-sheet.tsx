"use client";

import { useSyncExternalStore } from "react";
import { Modal } from "@/components/ui";
import { formatCombo } from "@/lib/hotkeys";
import styles from "./shortcut-sheet.module.css";

/** Single source for the sheet; shell bindings mirror these keys. */
export const SHORTCUT_GROUPS: Array<{ title: string; items: Array<{ keys: string; label: string }> }> = [
  {
    title: "Global",
    items: [
      { keys: "mod+k", label: "Command palette" },
      { keys: "mod+j", label: "New chat" },
      { keys: "mod+/", label: "Focus prompt" },
      { keys: "?", label: "This shortcut sheet" },
      { keys: "Esc", label: "Close the topmost dialog" },
    ],
  },
  {
    title: "Navigate",
    items: [
      { keys: "g a", label: "Agent workspace" },
      { keys: "g m", label: "Manage workspace" },
      { keys: "g w", label: "Jump to “Waiting on you”" },
    ],
  },
  {
    title: "Waiting on you (card focused)",
    items: [
      { keys: "hold A", label: "Approve — press and hold, never a tap" },
      { keys: "R", label: "Reject" },
      { keys: "Enter", label: "Send the typed answer" },
    ],
  },
];

const subscribe = () => () => {};
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mac = useSyncExternalStore(subscribe, isMac, () => false);
  const show = (keys: string) =>
    keys.startsWith("hold ") || keys === "Esc" || keys === "Enter" || keys === "R"
      ? keys
      : formatCombo(keys, mac);

  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" description="Bare keys are ignored while typing in a field.">
      <div className={styles.groups}>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3 className={styles.heading}>{group.title}</h3>
            <dl className={styles.list}>
              {group.items.map((item) => (
                <div key={item.label} className={styles.row}>
                  <dt>{item.label}</dt>
                  <dd>
                    <kbd className={styles.kbd}>{show(item.keys)}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
