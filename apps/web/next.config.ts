import type { NextConfig } from "next";

const nextConfig = (): NextConfig => ({
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: [
    "@spielos/core",
    "@spielos/design-system",
    "@spielos/evals",
    "@spielos/graph"
  ],
  poweredByHeader: false,
  experimental: {
    workerThreads: false,
    cpus: 1
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      }
    ];
  },
  async redirects() {
    return [
      { source: "/prompts", destination: "/strategy", permanent: true },
      { source: "/library", destination: "/knowledge", permanent: true },
      { source: "/assets", destination: "/knowledge", permanent: true },
    ];
  }
});

export default nextConfig;
