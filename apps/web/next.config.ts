import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig = (phase: string): NextConfig => ({
  distDir:
    process.env.NEXT_DIST_DIR ||
    (phase === PHASE_DEVELOPMENT_SERVER ? ".next" : ".next-build"),
  transpilePackages: [
    "@spielos/core",
    "@spielos/design-system",
    "@spielos/evals",
    "@spielos/graph"
  ],
  experimental: {
    // Keep the dev server pinned to a single thread to bound memory usage.
    // `NODE_OPTIONS=--max-old-space-size=4096` is the primary lever; these
    // options keep the per-request worker fanout from spiking RSS.
    workerThreads: false,
    cpus: 1
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
