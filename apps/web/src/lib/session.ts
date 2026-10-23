/**
 * Player identity in the browser. The API issues every identity: signed-in
 * users get a token through /api/token (web server), visitors get a guest token
 * straight from the API. The token goes on every API call and the WS join.
 */
import { API_BASE } from "./api";

export interface Player {
  token: string;
  playerId: string;
  type: "user" | "guest";
}

const KEY = "fm_player";
const REFRESH_MS = 5 * 60_000;
let inflight: Promise<Player> | null = null;

function expiresAt(token: string): number {
  try {
    const part = token.split(".")[1] ?? "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return Number((JSON.parse(json) as { exp?: number }).exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

function read(): Player | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Player) : null;
  } catch {
    return null;
  }
}

function save(p: Player): Player {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: keep in memory only */ }
  return p;
}

export function clearPlayer(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * The current player. Pass the Auth.js user id when known (null when signed
 * out) so a sign-in or sign-out switches identity instead of reusing a stale one.
 */
export function getPlayer(signedInUserId?: string | null, force = false): Promise<Player> {
  const cached = read();
  const fresh = cached && expiresAt(cached.token) - Date.now() > REFRESH_MS;
  const identityMatches =
    signedInUserId === undefined ||
    (signedInUserId === null ? cached?.type === "guest" : cached?.type === "user" && cached.playerId === signedInUserId);
  if (!force && cached && fresh && identityMatches) return Promise.resolve(cached);
  inflight ??= fetchPlayer(signedInUserId, cached).finally(() => { inflight = null; });
  return inflight;
}

async function fetchPlayer(signedInUserId: string | null | undefined, cached: Player | null): Promise<Player> {
  if (signedInUserId !== null) {
    const r = await fetch("/api/token", { cache: "no-store" }).catch(() => null);
    if (r?.ok) {
      const p = (await r.json()) as Player;
      return save({ token: p.token, playerId: p.playerId, type: "user" });
    }
  }
  const headers: Record<string, string> = {};
  if (cached?.type === "guest") headers.Authorization = `Bearer ${cached.token}`;
  const r = await fetch(`${API_BASE}/v1/session`, { method: "POST", headers });
  if (!r.ok) throw new Error("We could not start a session. Check your connection and try again.");
  const p = (await r.json()) as Player;
  return save({ token: p.token, playerId: p.playerId, type: "guest" });
}

/** fetch() against the API with the player token attached; retries once on an expired token. */
export async function apiFetch(path: string, init: RequestInit = {}, signedInUserId?: string | null): Promise<Response> {
  const send = async (p: Player) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${p.token}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  };
  let res = await send(await getPlayer(signedInUserId));
  if (res.status === 401) {
    clearPlayer();
    res = await send(await getPlayer(signedInUserId, true));
  }
  return res;
}

/** Plain-language text for the API's error codes. */
export function describeError(code: string | undefined): string {
  switch (code) {
    case "sign_in_required": return "Sign in with X to play other people. Guests can play the house bots.";
    case "rate_limit_exceeded": return "That was a lot of requests at once. Wait a moment and try again.";
    case "wallet_unavailable": return "Your wallet is still being set up. Try again in a few seconds.";
    case "bot_not_ready": return "That bot is warming up. Pick another or try again shortly.";
    case "invalid_time_control": return "Pick one of the listed time controls.";
    case "not_found": return "That game or link no longer exists.";
    case "own_challenge": return "This is your own challenge link. Send it to a friend.";
    case "unauthorized": return "Your session expired. Reload the page and try again.";
    default: return "Something went wrong. Try again.";
  }
}
