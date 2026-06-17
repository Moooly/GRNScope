import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  async rewrites() {
    const backendOrigin =
      process.env.NEXT_INTERNAL_API_PROXY_TARGET || "http://127.0.0.1:8000";

    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
      {
        source: "/algorithms",
        destination: `${backendOrigin}/algorithms`,
      },
    ];
  },
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
