/**
 * Auth middleware helpers for Hono routes.
 *
 * requirePlayer(c)  → returns TokenPayload or sends 401
 * requireAdmin(c)   → checks Authorization: Bearer <ADMIN_TOKEN> or sends 403
 * requireInternal(c)→ checks X-Internal-Secret header or sends 403
 * requireSelf(c, targetId) → requirePlayer then checks sub === targetId
 */
import type { Context } from "hono";
import { playerFromHeader, type TokenPayload } from "./tokens.ts";
import { cfg } from "../config/index.ts";

/** Resolve the caller's token. Returns null (and sends 401) if missing/invalid. */
export function requirePlayer(c: Context): TokenPayload | null {
  const auth = c.req.header("Authorization");
  const payload = playerFromHeader(auth);
  if (!payload) {
    c.res = c.json({ error: "unauthorized" }, 401) as unknown as typeof c.res;
    return null;
  }
  return payload;
}

/** Check ADMIN_TOKEN. Returns false (and sends 403) if missing/wrong. */
export function requireAdmin(c: Context): boolean {
  const token = cfg.ADMIN_TOKEN;
  if (!token) {
    // Admin routes disabled when ADMIN_TOKEN is not configured
    c.res = c.json({ error: "admin_disabled" }, 403) as unknown as typeof c.res;
    return false;
  }
  const auth = c.req.header("Authorization") ?? "";
  const provided = auth.replace(/^Bearer\s+/i, "").trim();
  if (provided !== token) {
    c.res = c.json({ error: "forbidden" }, 403) as unknown as typeof c.res;
    return false;
  }
  return true;
}

/** Check INTERNAL_SECRET (used for web→API server-to-server calls). */
export function requireInternal(c: Context): boolean {
  const secret = cfg.INTERNAL_SECRET;
  if (!secret) {
    // Fall back to admin check when no internal secret configured
    return requireAdmin(c);
  }
  const provided = c.req.header("X-Internal-Secret") ?? "";
  if (provided !== secret) {
    c.res = c.json({ error: "forbidden" }, 403) as unknown as typeof c.res;
    return false;
  }
  return true;
}
