/**
 * Referee: game state machine.
 * Lives in memory (per server process); survives restart via DB reload.
 */
import { createHash } from "crypto";
import {
  parseFEN,
  applyMove,
  legalMoves,
  outcome,
  repetitionKey,
  moveToUci,
  toFEN,
  START_FEN,
  type Position,
} from "@final-move/chess";
import { sql } from "../db/client.ts";
import { redis } from "../db/redis.ts";
import {
  initClocks,
  startClock,
  applyMoveClock,
  deleteClocks,
} from "./clocks.ts";
import {
  enqueueMoveJob,
  enqueueEndGame,
  enqueueCreateGame,
} from "../chain/writer.ts";
import { cfg, TOPUP_THRESHOLD_USDC6, TOPUP_AMOUNT_USDC6 } from "../config/index.ts";
import { getUsdcBalance, createTokenTransfer, uuidV5 } from "../chain/circle.ts";
import type { GameResult, GameEndReason } from "@final-move/shared";
import { RESULT_CODES } from "@final-move/shared";
import { applyResult } from "../ratings/index.ts";
import { checkFairPlay } from "../fairplay/index.ts";

// Maps GameEndReason → uint8 reason code stored on-chain (matches docs/contracts.md order)
const REASON_CODES: Record<GameEndReason, number> = {
  checkmate: 0, resignation: 1, timeout: 2, abandon: 3, stalemate: 4,
  repetition: 5, "fifty-move": 6, "insufficient-material": 7, agreement: 8, aborted: 9,
};

// ── In-memory game state ──────────────────────────────────────────────────────

export interface LiveGame {
  id: string;
  chainGameId: string;         // bytes32 hex
  whiteId: string;
  whiteKind: "user" | "agent" | "bot";
  whiteAddr: string;
  whiteWalletId: string;
  blackId: string;
  blackKind: "user" | "agent" | "bot";
  blackAddr: string;
  blackWalletId: string;
  class: "open" | "human";
  baseSec: number;
  incSec: number;
  position: Position;
  history: string[];           // repetition keys
  moves: string[];             // UCI list (for PGN / replay)
  plyCount: number;            // plies played
  status: "waiting" | "live" | "ended" | "aborted";
  chainLive: boolean;            // true once createGame tx is COMPLETE on-chain
  pendingMoves: Array<{ kind: "move"; gameId: string; ply: number; uci: string; walletId: string; moveRowId: string }>;
  result?: GameResult;
  reason?: GameEndReason;
  abandonTimer?: ReturnType<typeof setTimeout>;
  abortTimer?: ReturnType<typeof setTimeout>;
}

const liveGames = new Map<string, LiveGame>();

export function getLiveGame(gameId: string): LiveGame | undefined {
  return liveGames.get(gameId);
}

// ── nanoid-lite ───────────────────────────────────────────────────────────────
function nid(prefix: string) {
  return prefix + Math.random().toString(36).slice(2, 10);
}

// ── Create a new game ─────────────────────────────────────────────────────────

export interface CreateGameOpts {
  whiteId: string;
  whiteKind: "user" | "agent" | "bot";
  whiteAddr: string;
  whiteWalletId: string;
  blackId: string;
  blackKind: "user" | "agent" | "bot";
  blackAddr: string;
  blackWalletId: string;
  gameClass: "open" | "human";
  baseSec: number;
  incSec: number;
  timeControl: string;
  escrowMatchId?: string;
}

export async function createGame(opts: CreateGameOpts): Promise<LiveGame> {
  const gameId   = nid("g_");
  // Use a deterministic bytes32 from the game id
  const chainId  = "0x" + Buffer.from(gameId.padEnd(32, "\0")).toString("hex").padStart(64, "0");
  const matchId  = opts.escrowMatchId ?? "0x" + "00".repeat(32);

  const game: LiveGame = {
    id: gameId,
    chainGameId: chainId,
    whiteId: opts.whiteId,
    whiteKind: opts.whiteKind,
    whiteAddr: opts.whiteAddr,
    whiteWalletId: opts.whiteWalletId,
    blackId: opts.blackId,
    blackKind: opts.blackKind,
    blackAddr: opts.blackAddr,
    blackWalletId: opts.blackWalletId,
    class: opts.gameClass,
    baseSec: opts.baseSec,
    incSec: opts.incSec,
    position: parseFEN(START_FEN),
    history: [repetitionKey(parseFEN(START_FEN))],
    moves: [],
    plyCount: 0,
    status: "waiting",
    chainLive: false,
    pendingMoves: [],
  };

  // Persist
  await sql`
    INSERT INTO games
      (id, white_id, white_kind, black_id, black_kind, class, time_control,
       base_sec, inc_sec, status, chain_game_id, white_address, black_address,
       white_wallet_id, black_wallet_id, escrow_match_id)
    VALUES
      (${gameId}, ${opts.whiteId}, ${opts.whiteKind}, ${opts.blackId}, ${opts.blackKind},
       ${opts.gameClass}, ${opts.timeControl}, ${opts.baseSec}, ${opts.incSec},
       'waiting', ${chainId}, ${opts.whiteAddr}, ${opts.blackAddr},
       ${opts.whiteWalletId}, ${opts.blackWalletId}, ${matchId})
  `;

  liveGames.set(gameId, game);

  // Gas top-up check before game starts
  await maybeTopUp(opts.whiteWalletId, opts.whiteAddr);
  await maybeTopUp(opts.blackWalletId, opts.blackAddr);

  // On-chain createGame
  await enqueueCreateGame({
    kind: "createGame",
    gameId: chainId,
    whiteAddr: opts.whiteAddr,
    blackAddr: opts.blackAddr,
    gameClass: opts.gameClass === "open" ? 0 : 1,
    baseSec: opts.baseSec,
    incSec: opts.incSec,
    escrowMatchId: matchId,
  });

  // Clocks
  await initClocks(gameId, opts.baseSec);

  // Abort timer: if no first move within 30s
  game.abortTimer = setTimeout(() => abortGame(gameId, "aborted"), 30_000);

  return game;
}

// ── Start the game (first move received — starts white's clock) ───────────────

async function ensureStarted(game: LiveGame) {
  if (game.status !== "waiting") return;
  game.status = "live";
  clearTimeout(game.abortTimer);
  game.abortTimer = undefined;
  await sql`UPDATE games SET status='live', started_at=now() WHERE id=${game.id}`;
  await startClock(game.id);
  // Re-arm a 30s abort window for black's first reply.
  // If black never moves, the game aborts (no rating change, no "abandon").
  // This timer is cleared by handleMove when black's first move arrives.
  game.abortTimer = setTimeout(() => abortIfBlackHasNotMoved(game.id), 30_000);
}

async function abortIfBlackHasNotMoved(gameId: string) {
  const game = liveGames.get(gameId);
  if (!game || game.status !== "live") return;
  // Abort only if black has never moved (plyCount < 2)
  if (game.plyCount < 2) {
    await abortGame(gameId, "aborted");
  }
}

// ── Move handler ──────────────────────────────────────────────────────────────

export type MoveResult =
  | { ok: true;  fen: string; wMs: number; bMs: number; over: boolean; result?: GameResult; reason?: GameEndReason }
  | { ok: false; reason: string };

export async function handleMove(
  gameId: string,
  moverId: string,
  uci: string,
): Promise<MoveResult> {
  const game = liveGames.get(gameId);
  if (!game) return { ok: false, reason: "game_not_found" };
  if (game.status === "ended" || game.status === "aborted")
    return { ok: false, reason: "game_over" };

  // Who is to move?
  const expectedColor: "w" | "b" = game.plyCount % 2 === 0 ? "w" : "b";
  const expectedId = expectedColor === "w" ? game.whiteId : game.blackId;
  if (moverId !== expectedId) return { ok: false, reason: "not_your_turn" };

  // Ensure game is live (also arms the black-first-move abort timer)
  await ensureStarted(game);

  // Clear the black-first-move abort timer once black makes their first move.
  // At this point plyCount is still 1 (white has moved once; black is responding).
  if (game.plyCount === 1 && expectedColor === "b") {
    clearTimeout(game.abortTimer);
    game.abortTimer = undefined;
  }
  // From ply 2 onwards, abandon rules apply (not abort); do nothing extra here.

  // Reset abandon timer
  clearTimeout(game.abandonTimer);

  // Parse + validate the UCI move
  const uciMoves = legalMoves(game.position);
  const matched = uciMoves.find((m) => moveToUci(m) === uci);
  if (!matched) return { ok: false, reason: "illegal" };

  // Apply clock
  const nowMs = Date.now();
  const clockResult = await applyMoveClock(game.id, expectedColor, game.incSec, nowMs);
  if (clockResult.flagged) {
    // Flag fall — check insufficient material draw
    const o = outcome(game.position, repeatCount(game));
    const isDraw = o.over && o.winner === null;
    const res: GameResult = isDraw ? "draw" : (expectedColor === "w" ? "black" : "white");
    const rea: GameEndReason = isDraw ? "insufficient-material" : "timeout";
    await endGame(game, res, rea);
    return { ok: true, fen: toFEN(game.position), wMs: clockResult.wMs, bMs: clockResult.bMs, over: true, result: res, reason: rea };
  }

  // Apply the move
  const newPos = applyMove(game.position, matched);
  game.plyCount++;
  const ply = game.plyCount;
  game.moves.push(uci);
  game.history.push(repetitionKey(newPos));
  game.position = newPos;

  // Persist the move row
  const moveId = nid("mv_");
  const fenAfter = toFEN(newPos);
  await sql`
    INSERT INTO moves (id, game_id, ply, uci, fen_after, clock_w_ms, clock_b_ms, state)
    VALUES (${moveId}, ${gameId}, ${ply}, ${uci}, ${fenAfter}, ${clockResult.wMs}, ${clockResult.bMs}, 'queued')
  `;

  // Enqueue on-chain move — but only if createGame is COMPLETE on-chain
  const moverWalletId = expectedColor === "w" ? game.whiteWalletId : game.blackWalletId;
  const moveJob = { kind: "move" as const, gameId: game.chainGameId, ply, uci, walletId: moverWalletId, moveRowId: moveId };
  if (game.chainLive) {
    await enqueueMoveJob(moverWalletId, moveJob);
  } else {
    // Buffer until createGame confirms
    game.pendingMoves.push(moveJob);
  }

  // Broadcast the move over Redis pub/sub
  redis.publish(`game:${gameId}`, JSON.stringify({
    type: "move",
    gameId,
    ply,
    uci,
    fen: fenAfter,
    clockMs: { w: clockResult.wMs, b: clockResult.bMs },
  })).catch(() => {});

  // Check for game end
  const repeats = repeatCount(game);
  const gameOutcome = outcome(newPos, repeats);
  if (gameOutcome.over) {
    let res: GameResult;
    let rea: GameEndReason;
    if (gameOutcome.result === "checkmate") {
      res = gameOutcome.winner === "w" ? "white" : "black";
      rea = "checkmate";
    } else if (gameOutcome.result === "stalemate")     { res = "draw"; rea = "stalemate"; }
    else if (gameOutcome.result === "insufficient")    { res = "draw"; rea = "insufficient-material"; }
    else if (gameOutcome.result === "fifty-move")      { res = "draw"; rea = "fifty-move"; }
    else                                               { res = "draw"; rea = "repetition"; }
    await endGame(game, res, rea);
    return { ok: true, fen: fenAfter, wMs: clockResult.wMs, bMs: clockResult.bMs, over: true, result: res, reason: rea };
  }

  // Set abandon timer for the next player (60s)
  game.abandonTimer = setTimeout(() => handleAbandon(gameId), 60_000);

  return { ok: true, fen: fenAfter, wMs: clockResult.wMs, bMs: clockResult.bMs, over: false };
}

// ── End game ──────────────────────────────────────────────────────────────────

export async function endGame(
  game: LiveGame,
  result: GameResult,
  reason: GameEndReason,
) {
  if (game.status === "ended" || game.status === "aborted") return;

  clearTimeout(game.abandonTimer);
  clearTimeout(game.abortTimer);
  game.status = "ended";
  game.result = result;
  game.reason = reason;

  const fenHash = "0x" + createHash("sha256").update(toFEN(game.position)).digest("hex").slice(0, 64);

  await sql`
    UPDATE games
    SET status='ended', result=${result}, reason=${reason}, ended_at=now(), pgn=${buildPgn(game)}
    WHERE id=${game.id}
  `;

  await deleteClocks(game.id);

  // Wait for all plies to be on-chain before calling endGame
  scheduleEndGame(game, result, reason, fenHash);

  // Rating update (async, non-blocking)
  applyResult({
    whiteId:   game.whiteId,
    whiteKind: game.whiteKind,
    blackId:   game.blackId,
    blackKind: game.blackKind,
    result,
    cls:       game.class,
    tc:        `${game.baseSec / 60}+${game.incSec}` as "3+2" | "5+3" | "10+5",
  }).then((delta) => {
    if (delta) {
      redis.publish(`game:${game.id}`, JSON.stringify({
        type: "rating_delta",
        gameId: game.id,
        white: delta.white.delta,
        black: delta.black.delta,
      })).catch(() => {});
    }
  }).catch((e: unknown) => console.error("[ratings] failed:", (e as Error).message));

  // Auto-settle staked match if fully funded
  if (game.status === "ended") {
    const gameRow = await sql<{ stake_offer_id: string | null }[]>`
      SELECT stake_offer_id FROM games WHERE id=${game.id}
    `;
    const stakeOfferId = gameRow[0]?.stake_offer_id;
    if (stakeOfferId) {
      import("../stakes/index.ts").then(({ onStakedGameEnd }) =>
        onStakedGameEnd(stakeOfferId).catch((e: unknown) =>
          console.error("[stakes] auto-settle failed:", (e as Error).message),
        ),
      ).catch(() => {});
    }
  }

  // Tournament bracket advancement
  {
    const tgRow = await sql<{ tournament_id: string }[]>`
      SELECT tournament_id FROM tournament_games WHERE game_id=${game.id} LIMIT 1
    `;
    if (tgRow[0]) {
      import("../tournaments/index.ts").then(({ onTournamentGameEnd }) => {
        const winnerId = result === "white" ? game.whiteId
                       : result === "black" ? game.blackId
                       : null; // draw → white advances by tiebreak in onTournamentGameEnd
        return onTournamentGameEnd(game.id, winnerId);
      }).catch((e: unknown) => console.error("[tournament] advancement failed:", (e as Error).message));
    }
  }

  // Streak + title updates (async, non-blocking)
  updateStreaksAndTitles(game, result).catch((e: unknown) =>
    console.error("[streaks] failed:", (e as Error).message),
  );

  // HvM scoreboard update (async, non-blocking)
  updateHvM(game, result).catch(() => {});

  // Fair-play check for Human class
  if (game.class === "human" && result !== "aborted") {
    checkFairPlay(game.id).catch((e: unknown) =>
      console.error("[fairplay] failed:", (e as Error).message),
    );
  }

  redis.publish(`game:${game.id}`, JSON.stringify({
    type: "game_end",
    gameId: game.id,
    result,
    reason,
  })).catch(() => {});
}

function scheduleEndGame(game: LiveGame, result: GameResult, reason: GameEndReason, fenHash: string) {
  // Poll until all plies are complete, then enqueue endGame
  const totalPlies = game.plyCount;
  const resultCode = RESULT_CODES[result];

  const check = async () => {
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM moves
      WHERE game_id=${game.id} AND state NOT IN ('complete','final','relayed')
        AND ply <= ${totalPlies}
    `;
    const pending = Number(rows[0]?.count ?? 0);
    if (pending === 0) {
      await enqueueEndGame({
        kind: "endGame",
        gameId: game.chainGameId,
        result: resultCode,
        reasonCode: REASON_CODES[reason] ?? 0,
        totalPlies,
        fenHash,
      });
    } else {
      setTimeout(check, 3_000);
    }
  };
  setTimeout(check, 2_000);
}

async function abortGame(gameId: string, reason: GameEndReason) {
  const game = liveGames.get(gameId);
  // Allow abort from "waiting" (no first move at all) OR "live" with plyCount < 2
  // (white moved but black never replied within 30 s)
  if (!game) return;
  if (game.status !== "waiting" && !(game.status === "live" && game.plyCount < 2)) return;
  clearTimeout(game.abandonTimer);
  clearTimeout(game.abortTimer);
  game.status = "aborted";
  game.result = "aborted";
  game.reason = reason;
  await sql`UPDATE games SET status='aborted', result='aborted', reason=${reason}, ended_at=now() WHERE id=${gameId}`;
  await deleteClocks(gameId);
  redis.publish(`game:${gameId}`, JSON.stringify({ type: "game_end", gameId, result: "aborted", reason })).catch(() => {});

  // Close the game on-chain only when createGame already confirmed.
  // The contract requires pliesRecorded == totalPlies before endGame succeeds,
  // so wait for any already-submitted move plies to clear first.
  if (game.chainLive) {
    const fenHash = "0x" + createHash("sha256").update(toFEN(game.position)).digest("hex").slice(0, 64);
    scheduleEndGame(game, "aborted", reason, fenHash);
  }

  // For staked games, trigger escrow refund path (abort ⇒ both players refunded)
  {
    const gameRow = await sql<{ stake_offer_id: string | null }[]>`
      SELECT stake_offer_id FROM games WHERE id=${gameId}
    `;
    const stakeOfferId = gameRow[0]?.stake_offer_id;
    if (stakeOfferId) {
      import("../stakes/index.ts").then(({ onStakedGameEnd }) =>
        onStakedGameEnd(stakeOfferId).catch((e: unknown) =>
          console.error("[stakes] abort refund failed:", (e as Error).message),
        ),
      ).catch(() => {});
    }
  }

  liveGames.delete(gameId);
}

async function handleAbandon(gameId: string) {
  const game = liveGames.get(gameId);
  if (!game || game.status !== "live") return;
  const onMove: "w" | "b" = game.plyCount % 2 === 0 ? "w" : "b";
  const loser: GameResult  = onMove === "w" ? "black" : "white";
  await endGame(game, loser, "abandon");
}

// ── Resign / draw ─────────────────────────────────────────────────────────────

export async function handleResign(gameId: string, resignerId: string): Promise<boolean> {
  const game = liveGames.get(gameId);
  if (!game || game.status !== "live") return false;
  const isWhite = resignerId === game.whiteId;
  const result: GameResult = isWhite ? "black" : "white";
  await endGame(game, result, "resignation");
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function repeatCount(game: LiveGame): number {
  const key = game.history[game.history.length - 1]!;
  return game.history.filter((k) => k === key).length;
}

function buildPgn(game: LiveGame): string {
  // Minimal PGN — moves only
  return game.moves.map((uci, i) => {
    const moveNum = Math.floor(i / 2) + 1;
    return i % 2 === 0 ? `${moveNum}. ${uci}` : uci;
  }).join(" ");
}

// ── Streaks, Titles, HvM ─────────────────────────────────────────────────────

async function updateStreaksAndTitles(game: LiveGame, result: GameResult) {
  if (result === "aborted") return;
  const players = [
    { id: game.whiteId, won: result === "white" },
    { id: game.blackId, won: result === "black" },
  ];
  for (const { id, won } of players) {
    // Upsert streak
    const rows = await sql<{ current_streak: number; best_streak: number }[]>`
      SELECT current_streak, best_streak FROM streaks
      WHERE subject_id=${id} AND class=${game.class}
    `;
    const cur = rows[0];
    const prevStreak = cur?.current_streak ?? 0;
    const prevBest   = cur?.best_streak ?? 0;
    let newStreak: number;
    if (result === "draw") {
      newStreak = 0; // draw resets streak
    } else if (won) {
      newStreak = prevStreak >= 0 ? prevStreak + 1 : 1;
    } else {
      newStreak = prevStreak <= 0 ? prevStreak - 1 : -1;
    }
    const newBest = Math.max(prevBest, newStreak);
    await sql`
      INSERT INTO streaks (subject_id, subject_kind, class, current_streak, best_streak)
      VALUES (${id}, ${id.startsWith("bot_") ? "bot" : id.startsWith("ag_") ? "agent" : "user"},
              ${game.class}, ${newStreak}, ${newBest})
      ON CONFLICT (subject_id, class)
      DO UPDATE SET current_streak=${newStreak},
                    best_streak=GREATEST(streaks.best_streak, ${newBest}),
                    updated_at=now()
    `;
    // Award titles
    if (newStreak === 5) {
      await sql`
        INSERT INTO titles (subject_id, title) VALUES (${id}, 'On Fire')
        ON CONFLICT DO NOTHING
      `;
    }
    if (newStreak === 10) {
      await sql`
        INSERT INTO titles (subject_id, title) VALUES (${id}, 'Unstoppable')
        ON CONFLICT DO NOTHING
      `;
    }
  }
  // First win title
  if (result !== "draw") {
    const winnerId = result === "white" ? game.whiteId : game.blackId;
    const totalWins = await sql<{ cnt: string }[]>`
      SELECT COUNT(*) as cnt FROM games
      WHERE (white_id=${winnerId} AND result='white')
         OR (black_id=${winnerId} AND result='black')
    `;
    if (Number(totalWins[0]?.cnt ?? 0) === 1) {
      await sql`
        INSERT INTO titles (subject_id, title) VALUES (${winnerId}, 'First Win')
        ON CONFLICT DO NOTHING
      `;
    }
  }
}

async function updateHvM(game: LiveGame, result: GameResult) {
  if (result === "aborted") return;
  const isGuestId = (id: string) => id === "guest" || id.startsWith("guest_");
  // Guests are excluded from HvM (no stable identity, unrated)
  if (isGuestId(game.whiteId) || isGuestId(game.blackId)) return;
  const whiteIsHuman = game.whiteKind === "user";
  const blackIsHuman = game.blackKind === "user";
  // Only count human vs machine games
  if (whiteIsHuman === blackIsHuman) return;
  const humanWon = (whiteIsHuman && result === "white") || (blackIsHuman && result === "black");
  const machineWon = (!whiteIsHuman && result === "white") || (!blackIsHuman && result === "black");
  await sql`
    INSERT INTO hvm_scoreboard (id, human_wins, machine_wins, draws)
    VALUES (1, 0, 0, 0)
    ON CONFLICT (id) DO UPDATE SET
      human_wins   = hvm_scoreboard.human_wins   + ${humanWon ? 1 : 0},
      machine_wins = hvm_scoreboard.machine_wins + ${machineWon ? 1 : 0},
      draws        = hvm_scoreboard.draws        + ${result === "draw" ? 1 : 0},
      updated_at   = now()
  `;
}

// ── Gas top-up ────────────────────────────────────────────────────────────────

async function maybeTopUp(walletId: string, _addr: string) {
  try {
    const bal = await getUsdcBalance(walletId);
    if (bal >= TOPUP_THRESHOLD_USDC6) return;

    // Check daily cap
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const rows = await sql<{ total: string }[]>`
      SELECT COALESCE(SUM(amount_usdc6), 0) as total
      FROM topups WHERE created_at >= ${today.toISOString()}
    `;
    const dailySpent = BigInt(rows[0]?.total ?? "0");
    const { TOPUP_DAILY_CAP_USDC6 } = await import("../config/index.ts");
    if (dailySpent + TOPUP_AMOUNT_USDC6 > TOPUP_DAILY_CAP_USDC6) {
      console.warn(`[topup] daily cap reached, skipping top-up for ${walletId}`);
      return;
    }

    const amountStr = (Number(TOPUP_AMOUNT_USDC6) / 1_000_000).toFixed(6);
    const tx = await createTokenTransfer({
      idempotencyKey: uuidV5(`topup:${walletId}:${Date.now()}`),
      sourceWalletId: cfg.TREASURY_WALLET_ID,
      destinationAddress: _addr,
      tokenAddress: cfg.USDC_ADDRESS,
      amount: amountStr,
    });

    await sql`
      INSERT INTO topups (wallet_id, amount_usdc6, circle_tx_id)
      VALUES (${walletId}, ${TOPUP_AMOUNT_USDC6.toString()}, ${tx.id})
    `;
    console.log(`[topup] sent ${amountStr} USDC to ${walletId}`);
  } catch (e: unknown) {
    console.error(`[topup] failed for ${walletId}:`, (e as Error).message);
  }
}

// ── Called by chain writer once createGame tx is COMPLETE ─────────────────────

export async function markChainLive(chainGameId: string) {
  // Find the game by its chainGameId
  for (const game of liveGames.values()) {
    if (game.chainGameId === chainGameId) {
      game.chainLive = true;
      // Flush buffered moves
      for (const job of game.pendingMoves) {
        await enqueueMoveJob(job.walletId, job);
      }
      game.pendingMoves = [];
      console.log(`[referee] chain live for game ${game.id}, flushed buffered moves`);
      return;
    }
  }
}
