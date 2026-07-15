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
  async redirects() {
    return [
      { source: "/prompts", destination: "/strategy", permanent: true },
      { source: "/library", destination: "/knowledge", permanent: true },
      { source: "/assets", destination: "/knowledge", permanent: true },
    ];
  }
});

export default nextConfig;
