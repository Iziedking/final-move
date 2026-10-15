/**
 * Redis-backed server clocks.
 * Each game has two keys in Redis:
 *   clock:{gameId}:w  — white's remaining ms (integer string)
 *   clock:{gameId}:b  — black's remaining ms
 *   clock:{gameId}:since — epoch ms when the current player's turn started
 *   clock:{gameId}:turn  — "w" | "b"
 */
import { redis } from "../db/redis.ts";

function key(gameId: string, field: string) {
  return `clock:${gameId}:${field}`;
}

export async function initClocks(
  gameId: string,
  baseSec: number,
): Promise<void> {
  const baseMs = baseSec * 1000;
  const pipe = redis.pipeline();
  pipe.set(key(gameId, "w"), String(baseMs));
  pipe.set(key(gameId, "b"), String(baseMs));
  pipe.del(key(gameId, "since"));
  pipe.del(key(gameId, "turn"));
  await pipe.exec();
}

/** Called when the first move is expected (white's clock starts). */
export async function startClock(gameId: string): Promise<void> {
  await redis.set(key(gameId, "since"), String(Date.now()));
  await redis.set(key(gameId, "turn"), "w");
}

export interface ClockState {
  wMs: number;
  bMs: number;
  turn: "w" | "b";
  sinceMs: number; // when the current player's clock started
}

export async function getClock(gameId: string): Promise<ClockState | null> {
  const [wMs, bMs, since, turn] = await redis.mget(
    key(gameId, "w"),
    key(gameId, "b"),
    key(gameId, "since"),
    key(gameId, "turn"),
  );
  if (!wMs || !bMs || !since || !turn) return null;
  return {
    wMs:     Number(wMs),
    bMs:     Number(bMs),
    sinceMs: Number(since),
    turn:    turn as "w" | "b",
  };
}

/**
 * Called after a legal move is accepted.
 * Deducts elapsed time, applies increment, flips turn.
 * Returns updated clock state or null if the mover's clock ran out.
 */
export async function applyMoveClock(
  gameId: string,
  moverColor: "w" | "b",
  incSec: number,
  nowMs = Date.now(),
): Promise<{ wMs: number; bMs: number; flagged: boolean }> {
  const state = await getClock(gameId);
  if (!state) throw new Error(`no clock for game ${gameId}`);

  const elapsed = nowMs - state.sinceMs;
  const incMs = incSec * 1000;
  let remaining = (moverColor === "w" ? state.wMs : state.bMs) - elapsed + incMs;
  const flagged = remaining < 0;
  if (flagged) remaining = 0;

  const nextTurn: "w" | "b" = moverColor === "w" ? "b" : "w";
  const pipe = redis.pipeline();
  pipe.set(key(gameId, moverColor), String(remaining));
  pipe.set(key(gameId, "since"), String(nowMs));
  pipe.set(key(gameId, "turn"), nextTurn);
  await pipe.exec();

  return {
    wMs: moverColor === "w" ? remaining : state.wMs,
    bMs: moverColor === "b" ? remaining : state.bMs,
    flagged,
  };
}

export async function deleteClocks(gameId: string): Promise<void> {
  await redis.del(
    key(gameId, "w"),
    key(gameId, "b"),
    key(gameId, "since"),
    key(gameId, "turn"),
  );
}

/** Alias used by the HTTP/WS server layer — returns base time when clock not yet started. */
export async function getClocks(
  gameId: string,
  baseSec?: number,
): Promise<{ wMs: number; bMs: number }> {
  const [wRaw, bRaw, since] = await redis.mget(
    key(gameId, "w"),
    key(gameId, "b"),
    key(gameId, "since"),
  );

  // Stored base times but clock not yet started (game is in "waiting")
  if (wRaw && bRaw && !since) {
    return { wMs: Number(wRaw), bMs: Number(bRaw) };
  }

  const state = await getClock(gameId);
  if (!state) {
    // No Redis data at all — return base time if provided, else 0
    const base = baseSec !== undefined ? baseSec * 1000 : 0;
    return { wMs: base, bMs: base };
  }
  // If clock is running, deduct elapsed from the current player
  const now = Date.now();
  const elapsed = Math.max(0, now - state.sinceMs);
  return {
    wMs: state.turn === "w" ? Math.max(0, state.wMs - elapsed) : state.wMs,
    bMs: state.turn === "b" ? Math.max(0, state.bMs - elapsed) : state.bMs,
  };
}

/** Elapsed ms on the current player's turn (live). */
export async function elapsed(gameId: string): Promise<number> {
  const since = await redis.get(key(gameId, "since"));
  if (!since) return 0;
  return Date.now() - Number(since);
}
