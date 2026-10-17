'use client';

import { useState } from 'react';
import { Bug, CaretRight } from '@phosphor-icons/react/dist/ssr';
import type { DebugEntry } from '@/hooks/use-run-stream';
import styles from './modes.module.css';

/**
 * Debug mode readout (owner-only, like the whole panel): effective tool list
 * and schema tokens, redacted system prompt preview, request params, then
 * every model call / tool / gate / retry decision as raw JSON with timings.
 */
export function DebugPanel({ entries }: { entries: DebugEntry[] }) {
  const [open, setOpen] = useState(true);
  if (entries.length === 0) return null;
  const ctx = entries.find((e) => e.kind === 'context')?.data;
  const calls = entries.filter((e) => e.kind === 'model_call');
  const spent = calls.reduce((n, e) => n + Number(e.data.costUsd ?? 0), 0);
  const t0 = entries[0]?.at ?? 0;

  return (
    <section className={styles.debug} aria-label="Debug">
      <button type="button" className={styles.debugHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bug size={13} aria-hidden /> DEBUG · {entries.length} events · {calls.length} model calls · ${spent.toFixed(4)}
        <CaretRight
          size={10}
          weight="bold"
          aria-hidden
          style={{ marginLeft: 'auto', transform: open ? 'rotate(90deg)' : undefined }}
        />
      </button>
      {open && (
        <div className={styles.debugBody}>
          {ctx && (
            <>
              <div className={styles.debugRow}>
                <span>
                  <span className={styles.debugLabel}>mode</span> {String(ctx.mode)}
                </span>
                <span>
                  <span className={styles.debugLabel}>model</span> {String(ctx.model)}
                </span>
                <span>
                  <span className={styles.debugLabel}>tools</span> {String(ctx.toolCount)}
                </span>
                <span>
                  <span className={styles.debugLabel}>schema≈</span> {String(ctx.schemaTokens)} tok
                </span>
                <span>
                  <span className={styles.debugLabel}>system≈</span> {String(ctx.systemTokens)} tok
                </span>
                <span>
                  <span className={styles.debugLabel}>guide</span> {String(ctx.guideSource)}
                </span>
                <span>
                  <span className={styles.debugLabel}>limits</span> {String(ctx.maxSteps)} steps / $
                  {String(ctx.maxCostUsd)}
                </span>
              </div>
              <details>
                <summary>Request params (no keys)</summary>
                <pre>{JSON.stringify(ctx.requestParams, null, 2)}</pre>
              </details>
              <details>
                <summary>System prompt preview (redacted)</summary>
                <pre>{String(ctx.systemPreview ?? '')}</pre>
              </details>
              <details>
                <summary>Effective tools</summary>
                <pre>{(ctx.tools as string[] | undefined)?.join(', ')}</pre>
              </details>
            </>
          )}
          <details open>
            <summary>Events</summary>
            <pre>
              {entries
                .filter((e) => e.kind !== 'context')
                .map((e) => `+${((e.at - t0) / 1000).toFixed(1)}s #${e.seq} ${e.kind} ${JSON.stringify(e.data)}`)
                .join('\n')}
            </pre>
          </details>
        </div>
      )}
    </section>
  );
}
