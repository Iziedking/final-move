import type { NextConfig } from "next";
import path from "path";
import { readFileSync } from "fs";

// Load the repo-root .env so that AUTH_SECRET / SESSION_SECRET set there are
// visible to Next.js even when it starts from apps/web/.
// apps/web/.env.local takes precedence (Next.js loads it after this block).
try {
  const rootEnvPath = path.join(__dirname, "../../.env");
  const lines = readFileSync(rootEnvPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    // Strip inline comments (e.g. KEY=value # note) before unquoting
    const rawVal = trimmed.slice(eqIdx + 1);
    const val = rawVal.replace(/#[^"']*$/, "").trim().replace(/^["']|["']$/g, "");
    // Only set if not already defined — local env and .env.local override root .env
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
  // Auth.js v5 requires AUTH_SECRET specifically — mirror SESSION_SECRET if needed.
  if (!process.env.AUTH_SECRET && process.env.SESSION_SECRET) {
    process.env.AUTH_SECRET = process.env.SESSION_SECRET;
  }
} catch {
  // root .env not present — rely on process.env / apps/web/.env.local
}

// ── API proxy ──────────────────────────────────────────────────────────────────
// In the sandbox the browser can only reach port 5173 (the Preview panel).
// All API traffic is proxied through Next.js so the browser never needs to
// talk directly to the API server on :3001.
// NEXT_PUBLIC_SERVER_URL / NEXT_PUBLIC_API_URL default to "" (relative) so
// fetch("/v1/…") and ws(location.host + "/ws/…") work through the proxy.
const SERVER_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  // Allow the Arc Studio preview proxy hostname so the dev server doesn't 403
  // requests that arrive with the sandbox preview Host header.
  allowedDevOrigins: [
    "inyiwh3fur90h50ab66mp.preview.studio.arc.io",
    "*.preview.studio.arc.io",
    "localhost:5173",
    "localhost:3000",
    "127.0.0.1:5173",
    "127.0.0.1:3000",
  ],
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@final-move/ui", "@final-move/shared"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "abs.twimg.com" },
    ],
  },
  // Proxy /v1/* /ws/* /mcp/* → API server on :3001.
  // beforeFiles: fires before Next.js page/static matching so the rewrite
  // wins unconditionally for these paths.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/v1/:path*",  destination: `${SERVER_ORIGIN}/v1/:path*`  },
        { source: "/ws/:path*",  destination: `${SERVER_ORIGIN}/ws/:path*`  },
        { source: "/mcp/:path*", destination: `${SERVER_ORIGIN}/mcp/:path*` },
        { source: "/health",     destination: `${SERVER_ORIGIN}/health`      },
      ],
      afterFiles:  [],
      fallback:    [],
    };
  },
};

export default nextConfig;
