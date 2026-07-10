import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@spielos/core",
    "@spielos/design-system",
    "@spielos/evals",
    "@spielos/graph"
  ]
};

export default nextConfig;
