'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui';
import { api } from '@/components/settings/tabs/shared';
import { statusFor } from '@/lib/apps';
import type { AppStatus } from '@/lib/apps';
import { COMPOSIO_STATUS_KEY } from '@/lib/composio-types';
import type { ComposioAccount, ComposioStatus, ConnectResult, CredentialField } from '@/lib/composio-types';
import { useComposioStatus } from './use-composio';

export interface CredsDraft {
  toolkit: string;
  name: string;
  scheme: string;
  fields: CredentialField[];
  values: Record<string, string>;
}

export interface Note {
  text: string;
  href?: string | undefined;
  hrefLabel?: string | undefined;
}

export interface AppsCtx {
  status: ComposioStatus | undefined;
  statusLoading: boolean;
  accounts: ComposioAccount[];
  /** Connection state of a toolkit (null = never connected). */
  stateOf: (slug: string) => { status: AppStatus; account: ComposioAccount } | null;
  connect: (slug: string, name?: string) => void;
  connecting: string | null;
  disconnect: (accountId: string) => void;
  disconnecting: boolean;
  creds: CredsDraft | null;
  setCreds: (c: CredsDraft | null) => void;
  submitCreds: () => void;
  note: Note | null;
  clearNote: () => void;
  openApp: (slug: string) => void;
  refresh: () => void;
}

const Ctx = createContext<AppsCtx | null>(null);

export function useApps(): AppsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApps must be used inside <AppsProvider>');
  return v;
}

/**
 * The connect flow, reused from Settings -> Connectors: OAuth link in a new tab
 * + polling until ACTIVE, or an inline credential form for API-key apps. Values
 * go straight to Composio through the existing route; nothing is stored here.
 */
export function AppsProvider({ openApp, children }: { openApp: (slug: string) => void; children: ReactNode }) {
  const qc = useQueryClient();
  const toast = useToast();
  const statusQ = useComposioStatus();
  const [creds, setCreds] = useState<CredsDraft | null>(null);
  const [note, setNote] = useState<Note | null>(null);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: COMPOSIO_STATUS_KEY });
  }, [qc]);
  const onError = (e: Error) => toast.push({ title: 'Connect apps', message: e.message, tone: 'error' });

  const connectMut = useMutation({
    mutationFn: (v: { toolkit: string; name?: string | undefined; credentials?: Record<string, string> | undefined }) =>
      api<ConnectResult>('/api/connectors/composio', {
        method: 'POST',
        body: { action: 'connect', toolkit: v.toolkit, ...(v.credentials ? { credentials: v.credentials } : {}) },
      }),
    onSuccess: (r, v) => {
      const label = v.name ?? v.toolkit;
      setNote(null);
      if (r.kind === 'redirect') {
        const win = window.open(r.redirectUrl, '_blank', 'noopener,noreferrer');
        setNote(
          win
            ? { text: `Finish authorising ${label} in the new tab. This updates by itself once it is done.` }
            : {
                text: `Your browser blocked the new tab for ${label}.`,
                href: r.redirectUrl,
                hrefLabel: 'Open the authorisation page',
              },
        );
      } else if (r.kind === 'needs_credentials') {
        setCreds({ toolkit: v.toolkit, name: label, scheme: r.scheme, fields: r.fields, values: {} });
        openApp(v.toolkit);
      } else if (r.kind === 'unsupported') {
        setNote({ text: r.reason, href: r.guideUrl ?? undefined, hrefLabel: 'Composio setup guide' });
      } else {
        setCreds(null);
        setNote({ text: `${label} connected.` });
      }
      refresh();
    },
    onError,
  });

  const disconnectMut = useMutation({
    mutationFn: (accountId: string) =>
      api('/api/connectors/composio', { method: 'POST', body: { action: 'disconnect', accountId } }),
    onSuccess: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: [...COMPOSIO_STATUS_KEY, 'installed'] });
    },
    onError,
  });

  const accounts = statusQ.data?.configured ? statusQ.data.accounts : [];

  const value = useMemo<AppsCtx>(
    () => ({
      status: statusQ.data,
      statusLoading: statusQ.isPending,
      accounts,
      stateOf: (slug) => statusFor(accounts, slug),
      connect: (slug, name) => connectMut.mutate({ toolkit: slug, name }),
      connecting: connectMut.isPending ? (connectMut.variables?.toolkit ?? null) : null,
      disconnect: (id) => disconnectMut.mutate(id),
      disconnecting: disconnectMut.isPending,
      creds,
      setCreds,
      submitCreds: () => {
        if (creds) {
          connectMut.mutate(
            { toolkit: creds.toolkit, name: creds.name, credentials: creds.values },
            { onSuccess: (r) => r.kind === 'connected' && setCreds(null) },
          );
        }
      },
      note,
      clearNote: () => setNote(null),
      openApp,
      refresh,
    }),
    // mutation objects change identity per render; the fields read above are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      statusQ.data,
      statusQ.isPending,
      creds,
      note,
      connectMut.isPending,
      connectMut.variables,
      disconnectMut.isPending,
      openApp,
      refresh,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
