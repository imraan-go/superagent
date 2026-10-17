'use client';

import { useState } from 'react';
import { CaretRight, Lightbulb } from '@phosphor-icons/react/dist/ssr';
import styles from './modes.module.css';

/** Thinking mode: the model's summarised reasoning, collapsible and dimmed. */
export function ReasoningBlock({ text, live = false }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? live;
  if (!text.trim()) return null;
  return (
    <section className={styles.reasoning} aria-label="Reasoning">
      <button
        type="button"
        className={styles.reasoningHead}
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
      >
        <Lightbulb size={12} aria-hidden />
        {live ? 'Reasoning…' : 'Reasoning'}
        <CaretRight size={10} weight="bold" aria-hidden style={{ transform: expanded ? 'rotate(90deg)' : undefined }} />
      </button>
      {expanded && <p className={styles.reasoningBody}>{text}</p>}
    </section>
  );
}
