import type { NextConfig } from "next";
import { DEFAULT_VNC_ORIGIN, originOf, securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Docker image ships the minimal server bundle (docs/ARCHITECTURE.md §Docker).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,

  // Native/CJS modules that must stay outside the server bundle.
  serverExternalPackages: ["pg", "@node-rs/argon2"],

  // Dev-only: without this Next blocks HMR/dev assets when the page is opened
  // on a loopback host other than the one it printed, and nothing hydrates.
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          dev: process.env.NODE_ENV !== "production",
          vncOrigin: originOf(process.env.LHOS_VNC_URL, DEFAULT_VNC_ORIGIN),
        }),
      },
      {
        // SSE must never be buffered by an intermediate proxy.
        source: "/api/:path*/events",
        headers: [{ key: "X-Accel-Buffering", value: "no" }],
      },
    ];
  },
};

export default nextConfig;
