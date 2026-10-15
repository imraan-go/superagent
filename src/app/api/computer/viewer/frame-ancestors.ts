/**
 * True when a CSP's frame-ancestors directive admits `panelOrigin`, false when
 * it excludes it, null when the policy has no frame-ancestors directive.
 */
export function frameAncestorsAllows(csp: string, panelOrigin: string): boolean | null {
  const directive = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.toLowerCase().startsWith("frame-ancestors"));
  if (!directive) return null;
  const sources = directive.split(/\s+/).slice(1);
  const origin = new URL(panelOrigin);
  return sources.some((raw) => {
    const s = raw.replace(/\/$/, "");
    if (s === "*") return true;
    if (s === origin.origin || s === origin.host) return true;
    if (s === origin.protocol) return true; // scheme source, e.g. "https:"
    const wild = /^(https?:\/\/)?\*\.(.+)$/.exec(s);
    return wild ? origin.host.endsWith(`.${wild[2]}`) : false;
  });
}
