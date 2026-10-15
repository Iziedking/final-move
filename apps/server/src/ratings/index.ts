/**
 * TrueSkill rating persistence.
 * Called by the referee when a game ends.
 * Two classes (open / human), per time-control.
 */

import { sql } from "../db/client.ts";
import {
  updateOneVsOne,
  updateDraw,
  defaultRating,
} from "@final-move/chess";
import type { Rating } from "@final-move/chess";
import type { GameClass, TimeControl } from "../matchmaking/index.ts";

export async function loadRating(
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

export async function saveRating(
  subjectId: string,
  subjectKind: string,
  cls: GameClass,
  tc: TimeControl,
  r: Rating,
): Promise<void> {
  await sql`
    INSERT INTO ratings (subject_id, subject_kind, class, time_control, mu, sigma, games, updated_at)
    VALUES (${subjectId}, ${subjectKind}, ${cls}, ${tc}, ${r.mu}, ${r.sigma}, 1, now())
    ON CONFLICT (subject_id, class, time_control) DO UPDATE
      SET mu         = ${r.mu},
          sigma      = ${r.sigma},
          games      = ratings.games + 1,
          updated_at = now()
  `;
}

export interface RatingDelta {
  white: { before: Rating; after: Rating; delta: number };
  black: { before: Rating; after: Rating; delta: number };
}

/**
 * Apply a game result and persist ratings for both players.
 * Returns the before/after deltas so the UI can show "+12 μ" etc.
 * Bots don't participate in Human-class ratings.
 */
export async function applyResult(opts: {
  whiteId:   string;
  whiteKind: string;
  blackId:   string;
  blackKind: string;
  result:    "white" | "black" | "draw" | "aborted";
  cls:       GameClass;
  tc:        TimeControl;
}): Promise<RatingDelta | null> {
  // Bots are never rated in Human class
  if (opts.cls === "human" && (opts.whiteKind === "bot" || opts.blackKind === "bot")) {
    return null;
  }
  // Aborted games don't count
  if (opts.result === "aborted") return null;
  // Guests are never rated (they have no stable identity beyond this browser)
  const isGuestId = (id: string) => id === "guest" || id.startsWith("guest_");
  if (isGuestId(opts.whiteId) || isGuestId(opts.blackId)) return null;

  const wBefore = await loadRating(opts.whiteId, opts.cls, opts.tc);
  const bBefore = await loadRating(opts.blackId, opts.cls, opts.tc);

  let wAfter: Rating;
  let bAfter: Rating;

  if (opts.result === "white") {
    const updated = updateOneVsOne(wBefore, bBefore);
    wAfter = updated.winner;
    bAfter = updated.loser;
  } else if (opts.result === "black") {
    const updated = updateOneVsOne(bBefore, wBefore);
    wAfter = updated.loser;
    bAfter = updated.winner;
  } else {
    const updated = updateDraw(wBefore, bBefore);
    wAfter = updated.a;
    bAfter = updated.b;
  }

  await Promise.all([
    saveRating(opts.whiteId, opts.whiteKind, opts.cls, opts.tc, wAfter),
    saveRating(opts.blackId, opts.blackKind, opts.cls, opts.tc, bAfter),
  ]);

  // delta is the change in mu (not the conservative rating), so a loss always
  // reads as negative.  The conservative value (mu - 3σ) is used for leaderboard
  // ordering only and is not exposed to the end-screen.
  return {
    white: {
      before: wBefore,
      after:  wAfter,
      delta:  Math.round((wAfter.mu - wBefore.mu) * 10) / 10,
    },
    black: {
      before: bBefore,
      after:  bAfter,
      delta:  Math.round((bAfter.mu - bBefore.mu) * 10) / 10,
    },
  };
}

export async function getLeaderboard(
  cls: GameClass,
  tc: TimeControl,
  limit = 50,
): Promise<Array<{
  subjectId: string;
  subjectKind: string;
  mu: number;
  sigma: number;
  conservative: number;
  games: number;
}>> {
  const rows = await sql<{
    subject_id: string;
    subject_kind: string;
    mu: number;
    sigma: number;
    games: number;
  }[]>`
    SELECT subject_id, subject_kind, mu, sigma, games
    FROM ratings
    WHERE class=${cls} AND time_control=${tc} AND games >= 3
    ORDER BY (mu - 3 * sigma) DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    subjectId:    r.subject_id,
    subjectKind:  r.subject_kind,
    mu:           r.mu,
    sigma:        r.sigma,
    conservative: r.mu - 3 * r.sigma,
    games:        r.games,
  }));
}
