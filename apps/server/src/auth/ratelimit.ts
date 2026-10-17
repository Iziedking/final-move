/**
 * Simple in-memory sliding-window rate limiter.
 * Bucket key is typically "ip:<IP>" or "id:<playerId>".
 *
 * Limits:
 *   - Per IP:       60 requests / 60 s
 *   - Per identity: 30 requests / 60 s (tighter for authenticated callers)
 *   - Game creates: 5 / 60 s per identity
 */

interface Bucket {
  count:    number;
  resetAt:  number;
}

const buckets = new Map<string, Bucket>();

function getBucket(key: string, windowMs: number): Bucket {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  return b;
}

/** Returns true if the request is allowed. Increments the counter. */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs = 60_000,
): boolean {
  const b = getBucket(key, windowMs);
  if (b.count >= max) return false;
  b.count++;
  return true;
}

// Prune stale buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now > b.resetAt) buckets.delete(k);
  }
}, 5 * 60_000);
