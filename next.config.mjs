/** @type {import('next').NextConfig} */
const nextConfig = {
  // `postgres` and the Anthropic SDK are server-only; keep them out of bundling.
  serverExternalPackages: ["postgres"],
  webpack: (config) => {
    // Our src uses ESM-style `.js` import specifiers that resolve to `.ts` files
    // (works for tsx/tsc); teach webpack the same mapping.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
