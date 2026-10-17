'use client';

import { useSyncExternalStore } from 'react';
import { readTheme, setTheme, subscribeTheme } from '@/lib/theme';
import type { ThemePreference } from '@/lib/theme';

/**
 * Theme preference as a store, not as local state — so the topbar toggle and
 * the Settings Appearance tab stay in lockstep without a context provider.
 */
export function useTheme(): {
  theme: ThemePreference;
  setTheme: (next: ThemePreference) => void;
} {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'system' as const);
  return { theme, setTheme };
}
