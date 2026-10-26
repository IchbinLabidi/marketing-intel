import type { NextConfig } from "next";

// Cache Components is intentionally off: every app screen is per-user, per-workspace data
// read through the Supabase session cookie, so there is no static shell worth prerendering.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: { bodySizeLimit: "15mb" },
  },
};

export default nextConfig;
