import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  webpack(config, { webpack }) {
    if (process.env.NETLIFY === "true") {
      const shimPath = path.resolve(
        process.cwd(),
        "netlify/cloudflare-workers-shim.ts",
      );
      config.resolve.alias["cloudflare:workers"] = shimPath;
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/, shimPath),
      );
    }
    return config;
  },
};

export default nextConfig;
