import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker image ships the minimal server bundle (docs/ARCHITECTURE.md §Docker).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,

  // Native/CJS modules that must stay outside the server bundle.
  serverExternalPackages: ["pg", "@node-rs/argon2"],

  // Tailwind v4 via the Turbopack loader (Next 16 default bundler).
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=()" },
        ],
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
