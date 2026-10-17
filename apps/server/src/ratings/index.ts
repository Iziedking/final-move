/**
 * TrueSkill rating persistence.
 * Called by the referee when a game ends.
 * Two classes (open / human), per time-control.
 *
 * QA Round 4A: read-compute-write now runs inside a transaction with
 * SELECT ... FOR UPDATE to prevent lost updates when two games end concurrently.
 */

import { sql }         from "../db/client.ts";
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
 * Runs inside a Postgres transaction with SELECT … FOR UPDATE so two concurrent
 * game-end events never produce lost updates on the same row.
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

  // Use a transaction + advisory lock per (whiteId, blackId) pair to prevent
  // concurrent game-end events from racing each other's updates.
  let delta: RatingDelta | null = null;

  await sql.begin(async (tx) => {
    // Upsert placeholder rows first so FOR UPDATE has something to lock.
    await tx`
      INSERT INTO ratings (subject_id, subject_kind, class, time_control, mu, sigma, games, updated_at)
      VALUES
        (${opts.whiteId}, ${opts.whiteKind}, ${opts.cls}, ${opts.tc},
         ${defaultRating().mu}, ${defaultRating().sigma}, 0, now()),
        (${opts.blackId}, ${opts.blackKind}, ${opts.cls}, ${opts.tc},
         ${defaultRating().mu}, ${defaultRating().sigma}, 0, now())
      ON CONFLICT DO NOTHING
    `;

    // Lock both rows in a deterministic order to avoid deadlocks.
    const sorted = [opts.whiteId, opts.blackId].sort();
    const idA = sorted[0]!;
    const idB = sorted[1]!;
    const locked = await tx`
      SELECT subject_id, mu, sigma FROM ratings
      WHERE subject_id IN (${idA}, ${idB})
        AND class=${opts.cls} AND time_control=${opts.tc}
      ORDER BY subject_id
      FOR UPDATE
    ` as unknown as { subject_id: string; mu: number; sigma: number }[];

    const wRow = locked.find((r: { subject_id: string; mu: number; sigma: number }) => r.subject_id === opts.whiteId) ?? { mu: defaultRating().mu, sigma: defaultRating().sigma };
    const bRow = locked.find((r: { subject_id: string; mu: number; sigma: number }) => r.subject_id === opts.blackId) ?? { mu: defaultRating().mu, sigma: defaultRating().sigma };
    const wBefore: Rating = { mu: wRow.mu, sigma: wRow.sigma };
    const bBefore: Rating = { mu: bRow.mu, sigma: bRow.sigma };

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

    await tx`
      UPDATE ratings SET mu=${wAfter.mu}, sigma=${wAfter.sigma},
        games=games+1, updated_at=now()
      WHERE subject_id=${opts.whiteId} AND class=${opts.cls} AND time_control=${opts.tc}
    `;
    await tx`
      UPDATE ratings SET mu=${bAfter.mu}, sigma=${bAfter.sigma},
        games=games+1, updated_at=now()
      WHERE subject_id=${opts.blackId} AND class=${opts.cls} AND time_control=${opts.tc}
    `;

    delta = {
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
  });

  return delta;
}

export async function getRating(
  subjectId: string,
  cls: GameClass,
  tc: TimeControl,
): Promise<Rating> {
  return loadRating(subjectId, cls, tc);
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
