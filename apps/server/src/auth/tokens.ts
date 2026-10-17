/**
 * Server-side identity tokens.
 *
 * Two types:
 *   user   — signed-in NextAuth session user (type="user", sub=userId)
 *   guest  — server-issued per-browser guest token (type="guest", sub=guest_<16hex>)
 *
 * Format: base64url(header).base64url(payload).base64url(HMAC-SHA256)
 * Secret: SESSION_SECRET (required env var — server refuses to start without it)
 *
 * The browser receives a token from GET /v1/session and sends it as:
 *   REST:  Authorization: Bearer <token>
 *   WS:    first message { type:"join", token:"..." }
 *
 * The server ALWAYS derives the playerId from the token; it NEVER trusts
 * a playerId from the request body or query string.
 */

import { createHmac } from "crypto";
import { cfg } from "../config/index.ts";

export interface TokenPayload {
  sub:  string;          // player id  (u_xxx | guest_xxx | ag_xxx)
  type: "user" | "guest" | "agent";
  iat:  number;          // issued-at  (unix seconds)
  exp:  number;          // expires-at (unix seconds)
}

const ALG = "sha256";
const ISSUER_VERSION = "fm1"; // bump if we ever rotate the format

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString("base64url");
}

function sign(header: string, payload: string): string {
  const secret = cfg.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("[auth] SESSION_SECRET is not set or too short (need ≥32 chars)");
  }
  return b64url(createHmac(ALG, secret).update(`${header}.${payload}`).digest());
}

export function mintToken(
  sub: string,
  type: TokenPayload["type"],
  ttlSec = 3600,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: "HS256", ver: ISSUER_VERSION }));
  const payload = b64url(JSON.stringify({ sub, type, iat: now, exp: now + ttlSec } satisfies TokenPayload));
  const sig     = sign(header, payload);
  return `${header}.${payload}.${sig}`;
}

/** Returns the payload if the token is valid, or null if invalid / expired. */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts as [string, string, string];
    const expected = sign(header, payload);
    // Constant-time comparison
    if (!timingSafeEqual(sig, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as TokenPayload;
    if (!data.sub || !data.type || !data.exp) return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Extract the token from an Authorization header or return null. */
export function tokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

/** Derive player id from a request Authorization header; returns null if missing/invalid. */
export function playerFromHeader(authHeader: string | undefined): TokenPayload | null {
  const token = tokenFromHeader(authHeader);
  if (!token) return null;
  return verifyToken(token);
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i]! ^ bb[i]!;
  return diff === 0;
}
