/**
 * HTTP security headers for every panel response (docs/SECURITY_REVIEW.md).
 * Pure so next.config.ts and tests share it.
 *
 * CSP notes: Next's App Router inlines bootstrap scripts, so `script-src`
 * needs 'unsafe-inline' without a nonce pipeline; 'unsafe-eval' is dev-only
 * (React Refresh). `connect-src 'self'` covers fetch + SSE; the noVNC viewer
 * is the only framed origin.
 */
export const DEFAULT_VNC_ORIGIN = "https://vnc.hostx.h22t.com";

export function originOf(url: string | undefined, fallback: string): string {
  try {
    return url ? new URL(url).origin : fallback;
  } catch {
    return fallback;
  }
}

export function contentSecurityPolicy(opts: { dev: boolean; vncOrigin: string }): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(opts.dev ? ["ws:", "wss:"] : [])],
    "media-src": ["'self'", "data:", "blob:"],
    "frame-src": [opts.vncOrigin],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!opts.dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export function securityHeaders(opts: { dev: boolean; vncOrigin: string }): Array<{ key: string; value: string }> {
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(opts) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
  ];
  if (!opts.dev) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }
  return headers;
}
