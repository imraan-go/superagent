'use client';

import { useState } from 'react';
import { CheckCircle, CheckSquare, ChatCircleDots, Clock, Square } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { QuestionPart } from '@/lib/messages';
import styles from './question-card.module.css';

export interface QuestionAnswer {
  choices: string[];
  text?: string;
}

/**
 * A question the agent asked in chat. Pending: pick an option (single/confirm send at once,
 * multi needs Submit) or type a reply in the composer. Settled: shows what was chosen.
 * The run waits durably on the server, so answering hours later still continues it.
 */
export function QuestionCard({
  question: q,
  onAnswer,
  busy = false,
}: {
  question: QuestionPart;
  onAnswer?: (answer: QuestionAnswer) => void;
  busy?: boolean;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const pending = q.status === 'pending' && Boolean(onAnswer);
  const chosen = new Set(q.answer?.choices ?? []);
  const options = q.options;

  const pick = (id: string) => {
    if (!pending || busy) return;
    if (q.kind === 'multi') {
      setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
      return;
    }
    onAnswer?.({ choices: [id] });
  };

  return (
    <section
      className={cn(styles.card, q.kind === 'confirm' && styles.confirm, !pending && styles.settled)}
      aria-label="Question from the agent"
      data-status={q.status}
    >
      <header className={styles.head}>
        <ChatCircleDots size={15} weight="duotone" aria-hidden />
        <span className={styles.kicker}>{q.kind === 'confirm' ? 'Confirm' : 'Question'}</span>
        {q.status === 'expired' && (
          <span className={styles.state}>
            <Clock size={12} aria-hidden /> No answer in time
          </span>
        )}
        {q.status === 'answered' && (
          <span className={styles.state}>
            <CheckCircle size={12} weight="fill" aria-hidden /> Answered
          </span>
        )}
      </header>
      <p className={styles.prompt}>{q.prompt}</p>

      {options.length > 0 && (
        <ul
          className={cn(styles.options, q.kind === 'confirm' && styles.inline)}
          role={q.kind === 'multi' ? 'group' : 'radiogroup'}
        >
          {options.map((o, i) => {
            const on = pending ? picked.includes(o.id) : chosen.has(o.id);
            return (
              <li key={o.id}>
                <button
                  type="button"
                  className={cn(styles.option, on && styles.on)}
                  disabled={!pending || busy}
                  onClick={() => pick(o.id)}
                  role={q.kind === 'multi' ? 'checkbox' : 'radio'}
                  aria-checked={on}
                >
                  {q.kind === 'multi' ? (
                    on ? (
                      <CheckSquare size={15} weight="fill" aria-hidden />
                    ) : (
                      <Square size={15} aria-hidden />
                    )
                  ) : q.kind !== 'confirm' ? (
                    <span className={styles.letter} aria-hidden>
                      {String.fromCharCode(65 + i)}
                    </span>
                  ) : null}
                  <span>{o.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pending && q.kind === 'multi' && (
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="primary"
            disabled={picked.length === 0}
            loading={busy}
            onClick={() => onAnswer?.({ choices: picked })}
          >
            Submit{picked.length > 0 ? ` (${picked.length})` : ''}
          </Button>
        </div>
      )}

      {q.answer?.text && <p className={styles.reply}>“{q.answer.text}”</p>}
      {pending && (
        <p className={styles.hint}>
          {q.kind === 'text' ? 'Type your answer in the message box below.' : 'Or type a reply in the message box.'}
        </p>
      )}
    </section>
  );
}
