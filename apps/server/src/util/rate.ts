/**
 * In-process rate limiting.
 *
 * Two independent limiters:
 *   - IP limiter:       per remote IP, shared across all routes
 *   - Identity limiter: per authenticated player id
 *
 * Uses a simple token-bucket (fixed window) stored in a Map.
 * For a multi-process deploy, switch to Redis counters; the
 * interface is unchanged.
 *
 * Limits (conservative — tighten for mainnet):
 *   IP:       120 req / 60 s window
 *   Identity: 60  req / 60 s window (only counted for authenticated requests)
 *
 * Extra guards wired separately:
 *   - HTTP body cap:     enforced by the Hono bodyLimit middleware (64 KB)
 *   - WS maxPayload:     4 KB, set on the WebSocketServer constructor
 *   - WS message rate:   per-socket counter (applied in the WS handler)
 */

import type { Context } from "hono";

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS  = 60_000;
const IP_MAX     = 120;
const ID_MAX     = 60;

const ipBuckets  = new Map<string, Bucket>();
const idBuckets  = new Map<string, Bucket>();

function allow(map: Map<string, Bucket>, key: string, max: number): boolean {
  const now = Date.now();
  let b = map.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    map.set(key, b);
  }
  b.count++;
  return b.count <= max;
}

/** Returns the client IP from Hono context (CF-Connecting-IP → X-Forwarded-For → socket). */
function clientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * Hono middleware: rate-limit by IP (and optionally by playerId).
 * Call as:   app.use(rateLimit())
 * The identity slot is filled AFTER auth middleware runs; callers
 * that want per-identity limiting call `countIdentity(c, playerId)`.
 */
export function ipRateLimit() {
  return async (c: Context, next: () => Promise<void>): Promise<Response | void> => {
    const ip = clientIp(c);
    if (!allow(ipBuckets, ip, IP_MAX)) {
      return c.json({ error: "rate_limit_exceeded" }, 429);
    }
    await next();
  };
}

/**
 * Per-identity rate check.  Call this after resolving the caller's id.
 * Returns true if the request should be allowed.
 */
export function checkIdentityRate(playerId: string): boolean {
  return allow(idBuckets, playerId, ID_MAX);
}

/**
 * Lightweight per-socket WS message rate limiter.
 * Returns a function that returns true when the message is allowed.
 *
 * maxPerWindow: messages per 10-second window.
 */
export function makeWsRateLimiter(maxPerWindow = 30) {
  let count = 0;
  let resetAt = Date.now() + 10_000;
  return () => {
    const now = Date.now();
    if (now > resetAt) { count = 0; resetAt = now + 10_000; }
    count++;
    return count <= maxPerWindow;
  };
}

// Prune stale buckets every 5 minutes to prevent unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of ipBuckets) if (now > b.resetAt) ipBuckets.delete(k);
  for (const [k, b] of idBuckets) if (now > b.resetAt) idBuckets.delete(k);
}, 5 * 60_000).unref();
