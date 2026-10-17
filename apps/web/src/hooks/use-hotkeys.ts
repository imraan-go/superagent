'use client';

import { useEffect, useRef } from 'react';
import { resolveBinding } from '@/lib/hotkeys';
import type { Binding, MatchState } from '@/lib/hotkeys';

/**
 * Register global shortcuts. Bare keys and `g x` sequences are ignored while a
 * text field is focused; modifier combos fire there only with `allowInInput`.
 * Handlers are read through a ref, so callers can pass inline closures.
 */
export function useHotkeys(bindings: readonly Binding[]): void {
  const ref = useRef(bindings);
  useEffect(() => {
    ref.current = bindings;
  });

  useEffect(() => {
    const state: MatchState = { pending: null };
    const onKeyDown = (e: KeyboardEvent) => {
      const hit = resolveBinding(ref.current, e, e.target as Element | null, state, Date.now());
      if (!hit) return;
      e.preventDefault();
      hit.handler(e);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
