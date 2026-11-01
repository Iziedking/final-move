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

// ── API routing ────────────────────────────────────────────────────────────────
// Same-origin requests to /v1, /mcp and /health are rewritten to the API server,
// which covers local development. In production the browser calls
// NEXT_PUBLIC_API_ORIGIN directly. WebSocket upgrades never pass through
// rewrites, so the game socket always uses NEXT_PUBLIC_WS_URL (see useGameWs).
const SERVER_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";

// ── Security headers ───────────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === "production";

/** Origin (scheme + host) of a URL, or "" when unset or invalid. */
function originOf(url: string | undefined): string {
  if (!url) return "";
  try { return new URL(url).origin; } catch { return ""; }
}

const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_ORIGIN);
const wsOrigin = originOf(process.env.NEXT_PUBLIC_WS_URL);
// The page talks to its own origin and the API (HTTP and WebSocket forms).
const connectSrc = [
  "'self'",
  apiOrigin,
  apiOrigin && apiOrigin.replace(/^http/, "ws"),
  wsOrigin,
  isProd ? "" : "ws: http://localhost:3001",
].filter(Boolean).join(" ");

const csp = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; dev needs eval for fast refresh.
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  // The UI sets style attributes throughout.
  "style-src 'self' 'unsafe-inline'",
  // next/font self-hosts fonts at build time.
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://pbs.twimg.com https://abs.twimg.com",
  "media-src 'self'",
  `connect-src ${connectSrc}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://x.com https://twitter.com",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@final-move/ui", "@final-move/shared", "@final-move/chess"],
  // Workspace packages import their TypeScript siblings with Node-style ".js"
  // specifiers (./engine.js -> engine.ts); let webpack resolve them.
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "abs.twimg.com" },
    ],
  },
  // Rewrite /v1/* /mcp/* /health → API server (local development).
  // beforeFiles: fires before Next.js page/static matching so the rewrite
  // wins unconditionally for these paths.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/v1/:path*",  destination: `${SERVER_ORIGIN}/v1/:path*`  },
        { source: "/mcp/:path*", destination: `${SERVER_ORIGIN}/mcp/:path*` },
        { source: "/health",     destination: `${SERVER_ORIGIN}/health`      },
      ],
      afterFiles:  [],
      fallback:    [],
    };
  },
};

export default nextConfig;
