export interface AccountLite {
  id: string;
  toolkit: string;
  status: string;
  createdAt: string | null;
}

export type AppStatus = 'ACTIVE' | 'PENDING' | 'EXPIRED';

export interface InstalledGroup {
  toolkit: string;
  /** Best account for the toolkit: ACTIVE beats pending beats everything else. */
  status: AppStatus;
  accountId: string;
  accounts: number;
  createdAt: string | null;
}

export interface InstalledApp extends InstalledGroup {
  name: string;
  description: string;
  toolsCount: number;
  /** null when the tools could not be listed or the app is not active. */
  enabledCount: number | null;
}

const PENDING = new Set(['INITIALIZING', 'INITIATED']);

export function appStatus(raw: string): AppStatus {
  const s = raw.toUpperCase();
  return s === 'ACTIVE' ? 'ACTIVE' : PENDING.has(s) ? 'PENDING' : 'EXPIRED';
}

const ORDER: Record<AppStatus, number> = { ACTIVE: 0, PENDING: 1, EXPIRED: 2 };

/** One row per toolkit even when the owner holds several connected accounts for it. */
export function groupAccounts(accounts: AccountLite[]): InstalledGroup[] {
  const by = new Map<string, AccountLite[]>();
  for (const a of accounts) {
    if (!a.toolkit) continue;
    by.set(a.toolkit, [...(by.get(a.toolkit) ?? []), a]);
  }
  return [...by.entries()].map(([toolkit, list]) => {
    const best = [...list].sort((a, b) => ORDER[appStatus(a.status)] - ORDER[appStatus(b.status)])[0]!;
    return {
      toolkit,
      status: appStatus(best.status),
      accountId: best.id,
      accounts: list.length,
      createdAt: best.createdAt,
    };
  });
}

/** `acc_abcdefgh1234` -> `acc_…1234` : enough to recognise, never the whole id. */
export function maskId(id: string): string {
  return id.length <= 8 ? '••••' : `${id.slice(0, 4)}…${id.slice(-4)}`;
}
