import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  experimental: {
    // Cytoscape and its plugins are large; tree-shake their imports.
    optimizePackageImports: [
      "cytoscape",
      "cytoscape-cose-bilkent",
      "cytoscape-svg",
    ],
  },
};

export default nextConfig;
