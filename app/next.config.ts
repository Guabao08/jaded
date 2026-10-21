import type { NextConfig } from "next";
import { EnvError, parseEnv } from "./src/lib/env";
import { API_CSP, staticSecurityHeaders } from "./src/lib/security-headers";

// Refuse to start (dev, build or start) with a missing or invalid environment.
try {
  parseEnv(process.env);
} catch (error) {
  if (error instanceof EnvError) {
    console.error(`\n${error.message}\n\nCopy .env.example to .env and fill it in. See app/README.md.\n`);
    process.exit(1);
  }
  throw error;
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Native/WASM image libraries used on the server to render post images.
  serverExternalPackages: ["@resvg/resvg-js", "satori"],
  // cacheComponents and partial prefetching are left off on purpose: the
  // nonce-based CSP needs every page rendered per request, and Next.js
  // documents partial prerendering as incompatible with nonces.
  async headers() {
    return [
      { source: "/:path*", headers: [...staticSecurityHeaders] },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
    ];
  },
};

export default nextConfig;
