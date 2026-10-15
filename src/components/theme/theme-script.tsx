/**
 * Applies the stored theme before first paint so there is no flash of the wrong
 * palette. Runs ahead of hydration, hence the inline script. The authoritative
 * value lives in settings (`appearance.theme`); this mirror is written by the
 * theme store on change.
 */
const SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('fd.theme') || 'system';
    var dark = stored === 'dark' ||
      (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
