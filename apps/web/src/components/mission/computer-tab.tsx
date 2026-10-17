'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowSquareOut, Browser, Monitor } from '@phosphor-icons/react/dist/ssr';
import { Dot, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { OPEN_COMPUTER_EVENT } from '@/lib/hitl';
import type { SystemStatus } from '@/hooks/use-capabilities';
import type { RunStepView } from '@/lib/run-events';
import styles from './computer-tab.module.css';

interface Screen {
  id: string;
  url: string | null;
  title: string | null;
  taskId: string | null;
  createdAt: string;
}

export interface ComputerTabProps {
  capabilities?: SystemStatus;
  chatId?: string | null;
  /** True while the Computer tab is the visible one. */
  active: boolean;
  steps: RunStepView[];
  runId: string | null;
  /** Ask the rail to switch to this tab. */
  onRequestOpen: () => void;
}

/**
 * What the agent saw: the cloud browser's screenshots for this chat, newest first. The browser is
 * Google Chrome in a disposable E2B sandbox per run (destroyed when the run ends); screenshots are
 * stored artifacts, so they stay viewable afterwards.
 */
export function ComputerTab({ capabilities, chatId, active, steps, runId, onRequestOpen }: ComputerTabProps) {
  const browsing = steps.some((s) => (s.toolName ?? '').startsWith('browser_') && s.ok === null);
  const { data } = useQuery({
    queryKey: ['chat-screens', chatId],
    queryFn: async () => {
      const res = await fetch(`/api/chats/${chatId}/screens`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`screens ${res.status}`);
      return (await res.json()) as { screens: Screen[]; active: boolean };
    },
    enabled: Boolean(chatId) && active,
    refetchInterval: (q) => (q.state.data?.active || browsing ? 3_000 : false),
  });

  // A screenshot step in the live run brings this tab forward once per run.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    const shot = steps.some((s) => s.toolName === 'browser_screenshot');
    if (shot && runId && openedFor.current !== runId) {
      openedFor.current = runId;
      onRequestOpen();
    }
  }, [steps, runId, onRequestOpen]);

  useEffect(() => {
    const handler = () => onRequestOpen();
    window.addEventListener(OPEN_COMPUTER_EVENT, handler);
    return () => window.removeEventListener(OPEN_COMPUTER_EVENT, handler);
  }, [onRequestOpen]);

  const [picked, setPicked] = useState<string | null>(null);
  const screens = data?.screens ?? [];
  const current = screens.find((s) => s.id === picked) ?? screens[0] ?? null;
  const browserReady = capabilities?.capabilities.e2b_browser?.configured ?? false;
  const code = capabilities?.workspaces.find((w) => w.kind === 'code');

  return (
    <>
      <Panel
        title="Cloud browser"
        badge={
          <Dot
            status={browsing ? 'live' : browserReady ? 'idle' : 'warn'}
            size="sm"
            pulse={browsing}
            label={browsing ? 'browsing' : browserReady ? 'idle' : 'not set up'}
          />
        }
      >
        {!chatId ? (
          <p className={styles.muted}>Open a chat to see what the agent looked at.</p>
        ) : !current ? (
          <div className={styles.empty}>
            <Browser size={28} weight="duotone" aria-hidden />
            <p>
              {browserReady
                ? 'No screenshots in this chat yet. Ask the agent to open a site (name it in your message, or add it under Settings → Agent → Browsing).'
                : 'The cloud browser is not set up on this server (E2B_API_KEY, E2B_BROWSER_TEMPLATE_ID, AI_MODEL_BROWSER).'}
            </p>
          </div>
        ) : (
          <figure className={styles.view}>
            <a href={`/api/uploads/${current.id}`} target="_blank" rel="noreferrer" className={styles.shot}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/uploads/${current.id}`}
                alt={current.title ? `Screenshot of ${current.title}` : 'Browser screenshot'}
              />
            </a>
            <figcaption className={styles.caption}>
              <span className={styles.title}>{current.title || 'Untitled page'}</span>
              {current.url && (
                <a className={styles.url} href={current.url} target="_blank" rel="noreferrer noopener">
                  {current.url}
                  <ArrowSquareOut size={11} aria-hidden />
                </a>
              )}
              <time className={styles.time} dateTime={current.createdAt}>
                {new Date(current.createdAt).toLocaleTimeString()}
              </time>
            </figcaption>
          </figure>
        )}
        {screens.length > 1 && (
          <ul className={styles.strip} aria-label="Earlier screenshots">
            {screens.slice(0, 12).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={cn(styles.thumb, s.id === current?.id && styles.thumbOn)}
                  onClick={() => setPicked(s.id)}
                  aria-label={s.title ?? 'Screenshot'}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/uploads/${s.id}`} alt="" loading="lazy" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Cloud workspace"
        badge={
          <Dot
            status={code?.state === 'running' ? 'live' : code ? 'idle' : 'idle'}
            size="sm"
            label={code?.state ?? 'not started'}
          />
        }
      >
        <div className={styles.workspace}>
          <Monitor size={18} weight="duotone" aria-hidden />
          <p className={styles.muted}>
            {capabilities?.capabilities.e2b_code?.configured
              ? code
                ? `Your Python/files sandbox is ${code.state}${code.sandboxId ? ` (${code.sandboxId.slice(0, 12)})` : ''}. It pauses between runs so files persist without idle cost.`
                : 'Your Python/files sandbox starts the first time the agent needs it.'
              : 'The cloud workspace is not set up on this server (E2B_API_KEY).'}
          </p>
        </div>
      </Panel>
    </>
  );
}
