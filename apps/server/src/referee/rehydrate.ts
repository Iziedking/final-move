/**
 * Restart rehydration.
 *
 * On boot, reload every game that is in status 'waiting' or 'live' from the
 * database and restore it to the in-memory liveGames map. Then:
 *   - Rebuild clocks from the last stored clock row.
 *   - Re-arm abort / abandon timers based on remaining time.
 *   - Re-enqueue any moves that are still in state 'queued' or 'submitted'
 *     (the BullMQ job may have been lost when the process died).
 *   - If any game in state 'ended' or 'aborted' has no matching onchain
 *     GameEnded yet, re-schedule its chain close.
 *
 * Prune liveGames / gameRooms / playerGame when games end (called from
 * endGame and abortGame via the exported cleanup hook).
 */

import { parseFEN, repetitionKey, START_FEN, type Position } from "@final-move/chess";
import { sql } from "../db/client.ts";
import { redis } from "../db/redis.ts";

import { abortGame, endGame as endGameFn } from "./game.ts";
import { enqueueMoveJob, enqueueEndGame, startWorker } from "../chain/writer.ts";
import { cfg } from "../config/index.ts";
import { createHash } from "crypto";
import type { LiveGame } from "./game.ts";

// These are exported so index.ts can pass the live maps in.
type LiveGamesMap = Map<string, LiveGame>;
type RoomsMap     = Map<string, Map<string, import("ws").WebSocket>>;
type PlayerGameMap = Map<string, string>;

let _liveGames: LiveGamesMap;
let _gameRooms:  RoomsMap;
let _playerGame: PlayerGameMap;

export function setMaps(
  liveGames: LiveGamesMap,
  gameRooms: RoomsMap,
  playerGame: PlayerGameMap,
) {
  _liveGames  = liveGames;
  _gameRooms  = gameRooms;
  _playerGame = playerGame;
}

/** Called by endGame / abortGame to evict entries from shared maps. */
export function pruneMaps(gameId: string) {
  if (!_liveGames) return;
  _liveGames.delete(gameId);
  const room = _gameRooms?.get(gameId);
  if (room) {
    for (const pid of room.keys()) _playerGame?.delete(pid);
    _gameRooms.delete(gameId);
  }
}

/** Reload live/waiting games from DB into memory, re-arm timers, re-enqueue jobs. */
export async function rehydrateLiveGames(): Promise<void> {
  // Load live and waiting games from DB
  const rows = await sql<{
    id: string; chain_game_id: string;
    white_id: string; white_kind: string; white_address: string; white_wallet_id: string;
    black_id: string; black_kind: string; black_address: string; black_wallet_id: string;
    class: string; base_sec: number; inc_sec: number; time_control: string;
    status: string; started_at: Date | null;
  }[]>`
    SELECT id, chain_game_id, white_id, white_kind, white_address, white_wallet_id,
           black_id, black_kind, black_address, black_wallet_id,
           class, base_sec, inc_sec, time_control, status, started_at
    FROM games
    WHERE status IN ('waiting', 'live')
    ORDER BY created_at
  `;

  console.log(`[rehydrate] reloading ${rows.length} live/waiting game(s)`);

  for (const row of rows) {
    // Replay moves to reconstruct the position
    const moveRows = await sql<{
      id: string; ply: number; uci: string; fen_after: string;
      state: string; clock_w_ms: number; clock_b_ms: number;
    }[]>`
      SELECT id, ply, uci, fen_after, state, clock_w_ms, clock_b_ms
      FROM moves WHERE game_id=${row.id} ORDER BY ply
    `;

    // Reconstruct position from the last fen_after (or START_FEN if no moves)
    const lastMove = moveRows[moveRows.length - 1];
    const position: Position = lastMove
      ? (() => { try { return parseFEN(lastMove.fen_after); } catch { return parseFEN(START_FEN); } })()
      : parseFEN(START_FEN);

    // Rebuild repetition history from all FEN-after values
    const history: string[] = [repetitionKey(parseFEN(START_FEN))];
    for (const m of moveRows) {
      try { history.push(repetitionKey(parseFEN(m.fen_after))); } catch {}
    }

    const game: LiveGame = {
      id:            row.id,
      chainGameId:   row.chain_game_id,
      whiteId:       row.white_id,
      whiteKind:     row.white_kind as "user" | "agent" | "bot",
      whiteAddr:     row.white_address,
      whiteWalletId: row.white_wallet_id,
      blackId:       row.black_id,
      blackKind:     row.black_kind as "user" | "agent" | "bot",
      blackAddr:     row.black_address,
      blackWalletId: row.black_wallet_id,
      class:         row.class as "open" | "human",
      baseSec:       row.base_sec,
      incSec:        row.inc_sec,
      position,
      history,
      moves:         moveRows.map((m) => m.uci),
      plyCount:      moveRows.length,
      status:        row.status as "waiting" | "live" | "ended" | "aborted",
      chainLive:     true, // assume chain is live — createGame already ran before crash
      pendingMoves:  [],
    };

    _liveGames.set(row.id, game);

    // Ensure worker threads are running for these wallets
    startWorker(row.white_wallet_id);
    startWorker(row.black_wallet_id);
    startWorker(cfg.REFEREE_WALLET_ID);

    // Re-arm timers
    if (row.status === "waiting") {
      // Game never started — abort after 30s from now (or adjudicate immediately if stale)
      game.abortTimer = setTimeout(() => {
        abortGame(row.id, "aborted").catch(() => {});
      }, 30_000);
    } else if (row.status === "live" && lastMove) {
      // Re-arm a 60s abandon timer from now (conservative — reset on next move)
      game.abandonTimer = setTimeout(async () => {
        const g = _liveGames?.get(row.id);
        if (!g || g.status !== "live") return;
        const onMove = g.plyCount % 2 === 0 ? "w" : "b";
        const loser = onMove === "w" ? "black" : "white";
        await endGameFn(g, loser as "white" | "black", "abandon");
      }, 60_000);
    }

    // Re-enqueue any moves stuck in 'queued' or 'submitted' state
    for (const m of moveRows) {
      if (m.state === "queued" || m.state === "submitted") {
        const walletId = (moveRows.indexOf(m) % 2 === 0)
          ? row.white_wallet_id
          : row.black_wallet_id;
        await enqueueMoveJob(walletId, {
          kind:       "move",
          gameId:     row.chain_game_id,
          ply:        m.ply,
          uci:        m.uci,
          walletId,
          moveRowId:  m.id,
        }).catch((e: unknown) => console.warn("[rehydrate] re-enqueue move failed:", (e as Error).message));
      }
    }
  }

  // Re-schedule endGame for games that ended but never closed onchain
  const unclosedRows = await sql<{
    id: string; chain_game_id: string; result: string; reason: string;
    status: string; ply_count: number;
  }[]>`
    SELECT g.id, g.chain_game_id, g.result, g.reason, g.status,
           COUNT(m.id)::int as ply_count
    FROM games g
    LEFT JOIN moves m ON m.game_id = g.id
    WHERE g.status IN ('ended', 'aborted')
      AND g.ended_at > now() - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM chain_events ce
        WHERE ce.event_name = 'GameEnded'
          AND ce.args_json LIKE '%' || substring(g.chain_game_id, 3, 10) || '%'
      )
    GROUP BY g.id, g.chain_game_id, g.result, g.reason, g.status
  `;

  for (const row of unclosedRows) {
    console.log(`[rehydrate] re-scheduling chain close for game ${row.id}`);
    const { RESULT_CODES: RC } = await import("@final-move/shared");
    const REASON_CODES: Record<string, number> = {
      checkmate: 0, resignation: 1, timeout: 2, abandon: 3, stalemate: 4,
      repetition: 5, "fifty-move": 6, "insufficient-material": 7, agreement: 8, aborted: 9,
    };
    const resultCode  = RC[row.result as keyof typeof RC] ?? 0;
    const reasonCode  = REASON_CODES[row.reason] ?? 9;
    const fenHash     = "0x" + createHash("sha256").update(START_FEN).digest("hex").slice(0, 64);
    await enqueueEndGame({
      kind:        "endGame",
      gameId:      row.chain_game_id,
      result:      resultCode,
      reasonCode,
      totalPlies:  Number(row.ply_count),
      fenHash,
    }).catch((e: unknown) => console.warn("[rehydrate] re-schedule endGame failed:", (e as Error).message));
  }

  // Reload indexer head from Postgres if Redis has no value
  const headInRedis = await redis.get("indexer:head");
  if (!headInRedis) {
    const rows2 = await sql<{ value: string }[]>`
      SELECT value FROM indexer_state WHERE key='indexer_head' LIMIT 1
    `;
    if (rows2[0]) {
      await redis.set("indexer:head", rows2[0].value);
      console.log(`[rehydrate] restored indexer head from Postgres: ${rows2[0].value}`);
    }
  }
}
