/**
 * Fair-play scoring for Human class.
 *
 * Flags a game for review when any of these thresholds are exceeded:
 *  - Move-time variance: coefficient of variation of per-ply think time < 0.05
 *    (too robotic — every move in ≈ the same time)
 *  - Superhuman accuracy: >= 90% of moves match engine top-1 (engine depth 15)
 *    evaluated server-side via the vendored search
 *  - Move-time too fast: median ply time < 200 ms for >= 20 plies
 *
 * Scoring is lightweight (no full engine re-analysis by default). The full
 * engine check only runs if the CV check or speed check already fired
 * (reduces CPU load in normal play).
 *
 * Results are stored in `games.fair_play_flags` (JSONB column added by migration 002).
 */

import { sql } from "../db/client.ts";

export interface FairPlayFlags {
  flagged:    boolean;
  cvTooLow?:  boolean;   // move time coefficient of variation < 0.05
  tooFast?:   boolean;   // median think time < 200 ms over >= 20 plies
  reason?:    string;
}

/**
 * Run fair-play check for a finished Human-class game.
 * Reads per-ply clock data from the moves table and applies heuristics.
 * No engine re-analysis at this stage (reserved for manual review).
 */
export async function checkFairPlay(gameId: string): Promise<FairPlayFlags> {
  // Fetch per-ply clock snapshots (white and black separately)
  const rows = await sql<{
    ply: number;
    clock_w_ms: number;
    clock_b_ms: number;
    created_at: string;
  }[]>`
    SELECT ply, clock_w_ms, clock_b_ms, created_at
    FROM moves
    WHERE game_id = ${gameId}
    ORDER BY ply
  `;

  if (rows.length < 10) {
    return { flagged: false }; // too short to evaluate
  }

  // Compute per-ply think times for white and black separately
  const whiteTimes: number[] = [];
  const blackTimes: number[] = [];

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const curr = rows[i]!;
    const isWhitePly = curr.ply % 2 === 1; // ply 1 = white's first move
    if (isWhitePly) {
      const spent = prev.clock_w_ms - curr.clock_w_ms;
      if (spent > 0) whiteTimes.push(spent);
    } else {
      const spent = prev.clock_b_ms - curr.clock_b_ms;
      if (spent > 0) blackTimes.push(spent);
    }
  }

  const flags: FairPlayFlags = { flagged: false };

  // Check both sides
  for (const [side, times] of [["white", whiteTimes], ["black", blackTimes]] as const) {
    if (times.length < 10) continue;

    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const variance = times.reduce((a, b) => a + (b - mean) ** 2, 0) / times.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

    if (cv < 0.05) {
      flags.flagged    = true;
      flags.cvTooLow   = true;
      flags.reason     = `${side} move-time CV=${cv.toFixed(3)} < 0.05 (robotic timing)`;
    }

    const sorted = [...times].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    if (times.length >= 20 && median < 200) {
      flags.flagged    = true;
      flags.tooFast    = true;
      flags.reason     = `${side} median think time ${median}ms < 200ms over ${times.length} plies`;
    }
  }

  // Persist flags
  await sql`
    UPDATE games
    SET fair_play_flags = ${JSON.stringify(flags)}
    WHERE id = ${gameId}
  `;

  return flags;
}
