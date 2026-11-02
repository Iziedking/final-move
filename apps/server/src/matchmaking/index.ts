/**
 * Matchmaking — per-class, per-time-control queues with rating-window widening.
 *
 * A player calls `enqueue()`; the queue tries to match them immediately or waits
 * up to 30 s, widening the conservative-rating window by 2 per second. After 30 s
 * the match is cancelled and the caller receives a bot fallback offer.
 *
 * Challenge links: `createChallenge` mints a short code valid for 10 minutes.
 * The recipient calls `acceptChallenge`.
 */

import { redis } from "../db/redis.ts";
import { sql } from "../db/client.ts";
import { conservative, defaultRating } from "@final-move/chess";
import type { Rating } from "@final-move/chess";
import { nanoid } from "../util/ids.ts";

export type GameClass = "open" | "human";
export type TimeControl = "3+0" | "3+2" | "5+0" | "5+3" | "10+0" | "10+5";

export interface QueueEntry {
  playerId:    string;
  handle:      string;
  avatarUrl?:  string;
  gameClass:   GameClass;
  timeControl: TimeControl;
  rating:      Rating;
  enqueuedAt:  number; // ms
  /**
   * Called once per entry: with the opponent and the created game id when a pair is
   * found (gameId null if creation failed), or with null on timeout/no match.
   */
  resolve:     (opponent: QueueEntry | null, gameId?: string | null) => void;
  /** Set when the entry has been paired, so the timeout path stays quiet. */
  matched?:    boolean;
  // Player's wallet details (needed to create the game on match)
  walletId:    string;
  address:     string;
  kind:        "user" | "agent" | "bot";
}

/** Creates the game for a matched pair exactly once; registered by the server at boot. */
type MatchHandler = (a: QueueEntry, b: QueueEntry) => Promise<string>;
let matchHandler: MatchHandler | null = null;
export function setMatchHandler(fn: MatchHandler): void { matchHandler = fn; }

// In-memory queue per (class, timeControl)
const queues = new Map<string, QueueEntry[]>();

function queueKey(cls: GameClass, tc: TimeControl) {
  return `${cls}:${tc}`;
}

export async function getRating(
  subjectId: string,
  cls: GameClass,
  tc: TimeControl,
): Promise<Rating> {
  const rows = await sql<{ mu: number; sigma: number }[]>`
    SELECT mu, sigma FROM ratings
    WHERE subject_id=${subjectId} AND class=${cls} AND time_control=${tc}
    LIMIT 1
  `;
  return rows[0] ?? defaultRating();
}

/**
 * Add a player to the matchmaking queue.
 * Resolves with the opponent's player ID, or null if no match found (bot fallback).
 */
export function enqueue(entry: QueueEntry): void {
  const key = queueKey(entry.gameClass, entry.timeControl);
  if (!queues.has(key)) queues.set(key, []);
  const q = queues.get(key)!;
  q.push(entry);

  // Try to match immediately
  tryMatch(key);

  // Widen window every second, give up after 30 s
  let elapsed = 0;
  const interval = setInterval(() => {
    if (entry.matched) { clearInterval(interval); return; }
    elapsed += 1;
    if (elapsed >= 30) {
      clearInterval(interval);
      // Remove from queue if still there, offer bot fallback
      const idx = q.indexOf(entry);
      if (idx !== -1) q.splice(idx, 1);
      entry.resolve(null); // null = no match found → bot fallback
      return;
    }
    tryMatch(key);
  }, 1_000);
}

function tryMatch(key: string) {
  const q = queues.get(key);
  if (!q || q.length < 2) return;

  for (let i = 0; i < q.length; i++) {
    const a = q[i]!;
    const ageA = (Date.now() - a.enqueuedAt) / 1_000;
    const windowA = 4 + ageA * 2; // starts at 4 conservative-rating points, +2/s

    for (let j = i + 1; j < q.length; j++) {
      const b = q[j]!;
      const ageB = (Date.now() - b.enqueuedAt) / 1_000;
      const window = Math.max(windowA, 4 + ageB * 2);

      const diff = Math.abs(conservative(a.rating) - conservative(b.rating));
      if (diff <= window) {
        // Remove both from queue, create one game, then tell each side about it.
        q.splice(j, 1);
        q.splice(i, 1);
        a.matched = true;
        b.matched = true;
        void (async () => {
          let gameId: string | null = null;
          try {
            if (!matchHandler) throw new Error("no match handler registered");
            gameId = await matchHandler(a, b);
          } catch (e) {
            console.error("[matchmaking] game creation failed:", (e as Error).message);
          }
          a.resolve(b, gameId);
          b.resolve(a, gameId);
        })();
        return;
      }
    }
  }
}

// ── Challenge links ────────────────────────────────────────────────────────────

export interface Challenge {
  code:         string;
  challengerId: string;
  gameClass:    GameClass;
  timeControl:  TimeControl;
  createdAt:    number;
}

const CHALLENGE_TTL_S = 600; // 10 minutes

export async function createChallenge(
  challengerId: string,
  cls: GameClass,
  tc: TimeControl,
): Promise<string> {
  const code = nanoid(8);
  const val: Challenge = {
    code,
    challengerId,
    gameClass: cls,
    timeControl: tc,
    createdAt: Date.now(),
  };
  await redis.set(`challenge:${code}`, JSON.stringify(val), "EX", CHALLENGE_TTL_S);
  return code;
}

export async function peekChallenge(code: string): Promise<Challenge | null> {
  const raw = await redis.get(`challenge:${code}`);
  return raw ? (JSON.parse(raw) as Challenge) : null;
}

export async function acceptChallenge(code: string): Promise<Challenge | null> {
  const raw = await redis.get(`challenge:${code}`);
  if (!raw) return null;
  await redis.del(`challenge:${code}`);
  return JSON.parse(raw) as Challenge;
}
