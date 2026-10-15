/**
 * API origin helpers.
 *
 * Two deployment topologies:
 *
 * 1. Single origin / reverse proxy (recommended for production):
 *    The reverse proxy (nginx/caddy) serves both Next.js and the API server under
 *    the same domain, routing /v1/* /ws /mcp /health to the API server.
 *    Neither env var is set; all fetch calls use relative URLs ("/v1/...").
 *    WebSocket opens wss://same-host/ws — the reverse proxy upgrades it.
 *
 * 2. Separate origin (API on its own domain or port):
 *    Set NEXT_PUBLIC_API_ORIGIN=https://api.finalmove.io (no trailing slash).
 *    Set NEXT_PUBLIC_WS_URL=wss://api.finalmove.io (no trailing slash, no path).
 *    fetch calls become https://api.finalmove.io/v1/... (full absolute URL).
 *    WebSocket opens wss://api.finalmove.io/ws.
 *    The API server must send CORS headers that include the web origin.
 *
 * The sandbox proxy.mjs implements topology 1 on port 5173 — neither env var is
 * set and everything routes through the proxy.
 */

/** HTTP base for all /v1/* fetch calls from browser client components. */
export const API_BASE: string =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_ORIGIN) || "";

/** Internal HTTP base for server-side fetch (runs in Node, not the browser). */
export function serverApiBase(): string {
  return process.env.API_ORIGIN ?? "http://localhost:3001";
}
