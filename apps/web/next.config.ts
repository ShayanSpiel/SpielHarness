import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig = (phase: string): NextConfig => ({
  // A release/CI build can run while a local dev server is active. Let callers
  // isolate build artifacts so the two Next processes never corrupt `.next`.
  distDir:
    process.env.NEXT_DIST_DIR ||
    (phase === PHASE_DEVELOPMENT_SERVER ? ".next" : ".next-build"),
  transpilePackages: [
    "@spielos/core",
    "@spielos/design-system",
    "@spielos/evals",
    "@spielos/graph"
  ]
});

export default nextConfig;
