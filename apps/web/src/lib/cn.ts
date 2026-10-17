/**
 * Minimal class-name joiner. Deliberately not `clsx` + `tailwind-merge`: the
 * design system uses tokens and explicit variants rather than ad-hoc utility
 * overrides, so conflict resolution is not needed.
 */
export type ClassValue = string | number | null | undefined | false | ClassValue[];

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const v of values) {
    if (!v && v !== 0) continue;
    if (Array.isArray(v)) {
      const nested = cn(...v);
      if (nested) out.push(nested);
    } else {
      out.push(String(v));
    }
  }
  return out.join(' ');
}
