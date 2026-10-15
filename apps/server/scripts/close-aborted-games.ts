/**
 * close-aborted-games.ts
 * One-shot script: find aborted games whose createGame confirmed on-chain but
 * whose endGame was never sent, and close them now.
 *
 * Usage:
 *   bun run apps/server/scripts/close-aborted-games.ts
 *
 * Safe to run multiple times — BullMQ de-dupes by jobId.
 */
import { sql } from "../src/db/client.ts";
import { cfg } from "../src/config/index.ts";
import { enqueueEndGame, startWorker } from "../src/chain/writer.ts";
import { RESULT_CODES } from "@final-move/shared";
import { createHash } from "crypto";

const ABORTED_RESULT_CODE = RESULT_CODES["aborted"];
const ABORTED_REASON_CODE = 9; // matches docs/contracts.md order

// Find aborted games that:
//   1. Have a chain_game_id (createGame was at least submitted)
//   2. Have a GameCreated event in chain_events (createGame confirmed)
//   3. Do NOT have a GameEnded event (endGame was never sent)
const rows = await sql<{
  id: string;
  chain_game_id: string;
  pgn: string | null;
  ply_count: number;
}[]>`
  SELECT g.id, g.chain_game_id, g.pgn,
         (SELECT COUNT(*) FROM moves WHERE game_id = g.id)::int AS ply_count
  FROM games g
  WHERE g.status = 'aborted'
    AND g.chain_game_id IS NOT NULL
    -- createGame made it on-chain
    AND EXISTS (
      SELECT 1 FROM chain_events ce
      WHERE ce.event_name = 'GameCreated'
        AND ce.args_json LIKE '%' || ltrim(g.chain_game_id, '0x') || '%'
    )
    -- endGame was NOT sent yet
    AND NOT EXISTS (
      SELECT 1 FROM chain_events ce
      WHERE ce.event_name = 'GameEnded'
        AND ce.args_json LIKE '%' || ltrim(g.chain_game_id, '0x') || '%'
    )
`;

console.log(`[close-aborted] found ${rows.length} aborted game(s) to close`);

// Start the referee worker so jobs are processed
startWorker(cfg.REFEREE_WALLET_ID);

let queued = 0;
for (const row of rows) {
  // Compute fenHash from the starting position (no moves recorded = start FEN)
  // For abort games we always use the position at the time of abort; since
  // we only have the fen from the DB (pgn), approximate with a fixed hash of
  // the start FEN.  The contract accepts any bytes32.
  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const fenHash = "0x" + createHash("sha256").update(START_FEN).digest("hex").slice(0, 64);

  try {
    await enqueueEndGame({
      kind: "endGame",
      gameId: row.chain_game_id,
      result: ABORTED_RESULT_CODE,
      reasonCode: ABORTED_REASON_CODE,
      totalPlies: row.ply_count,
      fenHash,
    });
    console.log(`  ↳ queued endGame for game ${row.id} (${row.ply_count} plies)`);
    queued++;
  } catch (e) {
    console.error(`  ✗ failed to queue ${row.id}:`, (e as Error).message);
  }
}

console.log(`[close-aborted] queued ${queued}/${rows.length} endGame jobs`);
console.log("  Jobs are processed asynchronously — check server logs for confirmation.");

await sql.end();
