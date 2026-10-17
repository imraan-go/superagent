import type { ThemePreference } from '@/lib/theme';

/**
 * Applies the theme before first paint so there is no flash of the wrong
 * palette. Runs ahead of hydration, hence the inline script. The server-saved
 * `appearance.theme` is authoritative: the root layout passes it in, the script
 * uses it and refreshes the localStorage mirror (read by the theme store). The
 * stored value is only a fallback when the server value is unavailable.
 */
export function ThemeScript({ serverTheme }: { serverTheme?: ThemePreference | null }) {
  // `serverTheme` is a zod-validated enum, so interpolating it is safe.
  const seeded = serverTheme === 'dark' || serverTheme === 'light' || serverTheme === 'system' ? serverTheme : null;
  const script = `
(function () {
  try {
    var seeded = ${JSON.stringify(seeded)};
    if (seeded) localStorage.setItem('fd.theme', seeded);
    var stored = seeded || localStorage.getItem('fd.theme') || 'system';
    var dark = stored === 'dark' ||
      (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
