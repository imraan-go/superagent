"use client";

import { useSyncExternalStore } from "react";

/** Live `matchMedia` match. `serverValue` is what SSR and hydration assume. */
export function useMedia(query: string, serverValue = true): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** ≥1100px: both rails dock as columns (DESIGN_SYSTEM §Layout breakpoints). */
export const WIDE_QUERY = "(min-width: 1101px)";
