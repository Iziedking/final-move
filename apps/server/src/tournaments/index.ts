/**
 * Tournament orchestration — Saturday Cup.
 *
 * Flow:
 *   1. createTournament()   — referee creates on-chain tid + DB row
 *   2. fundTournament()     — treasury sends prize USDC to TournamentPool
 *   3. registerEntry()      — player/bot registers (free; entry fee = 0 for sponsored cups)
 *   4. startTournament()    — closes registration, builds bracket, saves bracket_json
 *   5. runNextMatch()       — called after each game ends; advances bracket
 *   6. finalizeTournament() — referee calls finalize() on-chain, distributes prizes
 */

import { sql }         from "../db/client.ts";
import { cfg }         from "../config/index.ts";
import { redis }       from "../db/redis.ts";
import {
  buildBracket, nextMatch, recordResult, champion, placements,
  type Seedable,
} from "@final-move/chess";
import { createContractExecution, createTokenTransfer } from "../chain/circle.ts";
import { nanoid } from "../util/ids.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

const POOL_ABI_CREATE   = "create(bytes32,uint256,uint16[],uint64)";
const POOL_ABI_FUND     = "fund(bytes32,uint256)";
const POOL_ABI_FINALIZE = "finalize(bytes32,address[])";
const POOL_ABI_CANCEL   = "cancel(bytes32)";

// Standard 8-player splits: 50/30/20 → 1st gets 50%, 2nd 30%, 3rd/4th 20% split
const DEFAULT_SPLITS_BPS: number[] = [5000, 3000, 1000, 1000]; // sum = 10000

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TournamentRow {
  id:              string;
  chain_tid:       string | null;
  name:            string;
  class:           string;
  time_control:    string;
  entry_fee_usdc6: bigint;
  prize_pool_usdc6: bigint;
  reg_close:       Date;
  starts_at:       Date;
  status:          string;
  bracket_json:    string | null;
  created_at:      Date;
  fund_tx_hash:    string | null;
}

export interface EntryRow {
  tournament_id: string;
  player_id:     string;
  player_kind:   string;
  placement:     number | null;
  prize_usdc6:   bigint;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBytes32(s: string): string {
  const buf = Buffer.from(s.replace(/-/g, "").slice(0, 32).padEnd(32, "\0"));
  return "0x" + buf.toString("hex");
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function createTournament(opts: {
  name:        string;
  gameClass:   "open" | "human";
  timeControl: string;
  regClose:    Date;
  startsAt:    Date;
  prizeUsdc6:  bigint;   // 0 for free cups (entry_fee = 0 always on testnet)
  sponsoredBy: string;   // label only
}): Promise<TournamentRow> {
  const id      = "t_" + nanoid(8);
  const chainTid = toBytes32(id);

  // On-chain: create tournament (entry fee = 0, splits = DEFAULT_SPLITS_BPS)
  try {
    const regCloseSec = Math.floor(opts.regClose.getTime() / 1000);
    await createContractExecution({
      walletId:            cfg.REFEREE_WALLET_ID,
      contractAddress:     cfg.POOL_ADDRESS,
      abiFunctionSignature: POOL_ABI_CREATE,
      abiParameters: [
        chainTid,
        "0",
        DEFAULT_SPLITS_BPS.map(String),
        String(regCloseSec),
      ],
      idempotencyKey: `create_tournament_${id}`,
    });
  } catch (err) {
    console.warn("[tournament] on-chain create failed (non-fatal):", (err as Error).message);
  }

  await sql`
    INSERT INTO tournaments
      (id, chain_tid, name, class, time_control, entry_fee_usdc6,
       prize_pool_usdc6, reg_close, starts_at, status)
    VALUES
      (${id}, ${chainTid}, ${opts.name}, ${opts.gameClass}, ${opts.timeControl},
       0, ${String(opts.prizeUsdc6)}, ${opts.regClose.toISOString()},
       ${opts.startsAt.toISOString()}, 'upcoming')
  `;

  const rows = await sql<TournamentRow[]>`SELECT * FROM tournaments WHERE id=${id}`;
  return rows[0]!;
}

export async function fundTournament(tournamentId: string): Promise<void> {
  const rows = await sql<TournamentRow[]>`SELECT * FROM tournaments WHERE id=${tournamentId}`;
  const t = rows[0];
  if (!t) throw new Error("tournament_not_found");
  if (BigInt(t.prize_pool_usdc6 ?? 0) <= 0n) return; // no prize to fund

  // Transfer from treasury to TournamentPool contract, then call fund()
  const fundAmount = (Number(t.prize_pool_usdc6) / 1_000_000).toFixed(6);
  const fundTx = await createTokenTransfer({
    sourceWalletId:   cfg.TREASURY_WALLET_ID,
    destinationAddress: cfg.POOL_ADDRESS,
    tokenAddress:     cfg.USDC_ADDRESS,
    amount:           fundAmount,
    idempotencyKey:   `fund_tournament_${tournamentId}`,
  });

  // Call fund() on-chain from treasury wallet (after transfer arrives)
  // On Arc this is near-instant; we do it optimistically
  try {
    await createContractExecution({
      walletId:            cfg.TREASURY_WALLET_ID,
      contractAddress:     cfg.POOL_ADDRESS,
      abiFunctionSignature: POOL_ABI_FUND,
      abiParameters:       [t.chain_tid!, String(t.prize_pool_usdc6)],
      idempotencyKey:      `fund_pool_${tournamentId}`,
    });
  } catch (err) {
    console.warn("[tournament] fund() call failed:", (err as Error).message);
  }

  const txId = fundTx.id ?? "";
  await sql`
    UPDATE tournaments
    SET fund_tx_hash=${txId}, status='open'
    WHERE id=${tournamentId}
  `;
}

export async function registerEntry(opts: {
  tournamentId: string;
  playerId:     string;
  playerKind:   "user" | "agent" | "bot";
}): Promise<void> {
  const rows = await sql<TournamentRow[]>`SELECT * FROM tournaments WHERE id=${opts.tournamentId}`;
  const t = rows[0];
  if (!t) throw new Error("tournament_not_found");
  if (!["upcoming", "open"].includes(t.status)) throw new Error("registration_closed");
  if (new Date() >= t.reg_close) throw new Error("reg_deadline_passed");

  await sql`
    INSERT INTO entries (tournament_id, player_id, player_kind)
    VALUES (${opts.tournamentId}, ${opts.playerId}, ${opts.playerKind})
    ON CONFLICT DO NOTHING
  `;

  // Open registration once first entry arrives
  if (t.status === "upcoming") {
    await sql`UPDATE tournaments SET status='open' WHERE id=${opts.tournamentId}`;
  }
}

export async function startTournament(tournamentId: string): Promise<void> {
  const rows = await sql<TournamentRow[]>`SELECT * FROM tournaments WHERE id=${tournamentId}`;
  const t = rows[0];
  if (!t) throw new Error("tournament_not_found");

  const entryRows = await sql<EntryRow[]>`
    SELECT * FROM entries WHERE tournament_id=${tournamentId}
  `;
  if (entryRows.length < 2) throw new Error("too_few_players");

  // Build bracket (use rating as tier for seeding)
  const seeds: Seedable[] = entryRows.map((e, i) => ({
    agentId: i,       // index into entryRows
    tier:    0,       // all equal for now; TODO: use trueskill rating
  }));
  const bracket = buildBracket(seeds);

  await sql`
    UPDATE tournaments
    SET status='running', bracket_json=${JSON.stringify({ bracket, entryRows })}
    WHERE id=${tournamentId}
  `;

  // Schedule the first match
  await scheduleNextMatch(tournamentId);
}

// ── Bracket runner ────────────────────────────────────────────────────────────

export async function scheduleNextMatch(tournamentId: string): Promise<void> {
  const rows = await sql<TournamentRow[]>`SELECT * FROM tournaments WHERE id=${tournamentId}`;
  const t = rows[0];
  if (!t || !t.bracket_json) return;

  const { bracket, entryRows } = JSON.parse(t.bracket_json) as {
    bracket: ReturnType<typeof buildBracket>;
    entryRows: EntryRow[];
  };

  const match = nextMatch(bracket);
  if (!match) {
    // Tournament complete — finalize
    await doFinalize(tournamentId, bracket, entryRows);
    return;
  }

  const whiteEntry = entryRows[match.a!]!;
  const blackEntry = entryRows[match.b!]!;

  // Create the game via DB (the referee game loop picks it up)
  const { createGame } = await import("../referee/game.ts");

  // Fetch wallets for both players
  const [whiteWallet, blackWallet] = await Promise.all([
    getPlayerWallet(whiteEntry.player_id),
    getPlayerWallet(blackEntry.player_id),
  ]);

  const tcParts = t.time_control.split("+");
  const baseSec = parseInt(tcParts[0] ?? "5", 10) * 60;
  const incSec  = parseInt(tcParts[1] ?? "3", 10);

  const game = await createGame({
    whiteId:       whiteEntry.player_id,
    whiteKind:     whiteEntry.player_kind as "user" | "agent" | "bot",
    whiteAddr:     whiteWallet.address,
    whiteWalletId: whiteWallet.walletId,
    blackId:       blackEntry.player_id,
    blackKind:     blackEntry.player_kind as "user" | "agent" | "bot",
    blackAddr:     blackWallet.address,
    blackWalletId: blackWallet.walletId,
    gameClass:     t.class as "open" | "human",
    baseSec,
    incSec,
    timeControl:   t.time_control,
  });

  // Record in tournament_games
  await sql`
    INSERT INTO tournament_games
      (tournament_id, game_id, round, match_index, white_player_id, black_player_id)
    VALUES
      (${tournamentId}, ${game.id}, ${match.round}, ${match.index},
       ${whiteEntry.player_id}, ${blackEntry.player_id})
    ON CONFLICT DO NOTHING
  `;

  // Save updated bracket state
  await sql`
    UPDATE tournaments SET bracket_json=${JSON.stringify({ bracket, entryRows })}
    WHERE id=${tournamentId}
  `;

  // Notify via Redis for watch page
  await redis.publish(`tournament:${tournamentId}`, JSON.stringify({
    type:           "match_scheduled",
    tournamentId,
    round:          match.round,
    matchIndex:     match.index,
    gameId:         game.id,
    whiteName:      whiteEntry.player_id,
    blackName:      blackEntry.player_id,
  }));
}

// Per-tournament lock key — prevents two simultaneous game-end callbacks
// from both thinking the next match hasn't been scheduled yet.
const scheduleLocks = new Map<string, Promise<void>>();

async function withScheduleLock(tournamentId: string, fn: () => Promise<void>): Promise<void> {
  const prev = scheduleLocks.get(tournamentId) ?? Promise.resolve();
  const next = prev.then(fn).catch((e: unknown) => {
    console.error("[tournament] scheduleNextMatch error:", (e as Error).message);
  });
  scheduleLocks.set(tournamentId, next);
  return next;
}

/** Called by the referee when a tournament game ends */
export async function onTournamentGameEnd(gameId: string, winnerId: string | null): Promise<void> {
  const tgRow = await sql<{
    tournament_id: string; round: number; match_index: number;
    white_player_id: string; black_player_id: string;
  }[]>`
    SELECT tournament_id, round, match_index, white_player_id, black_player_id
    FROM tournament_games WHERE game_id=${gameId}
  `;
  if (!tgRow[0]) return;

  const { tournament_id, round, match_index, white_player_id, black_player_id } = tgRow[0];

  await withScheduleLock(tournament_id, async () => {
    const rows = await sql<TournamentRow[]>`SELECT * FROM tournaments WHERE id=${tournament_id}`;
    const t = rows[0];
    if (!t || !t.bracket_json) return;

    const { bracket, entryRows } = JSON.parse(t.bracket_json) as {
      bracket: ReturnType<typeof buildBracket>;
      entryRows: EntryRow[];
    };

    // Skip if this match already has a winner (race: second callback for same match)
    const existingMatch = bracket.rounds[round]?.[match_index];
    if (existingMatch?.winner !== null) return;

    // Map playerId → bracket index
    const whiteIdx = entryRows.findIndex((e) => e.player_id === white_player_id);
    const blackIdx = entryRows.findIndex((e) => e.player_id === black_player_id);

    // On draw, white advances (tiebreak)
    const winnerIdx = winnerId === black_player_id ? blackIdx : whiteIdx;

    recordResult(bracket, round, match_index, winnerIdx);

    // Record winner in DB
    await sql`
      UPDATE tournament_games SET winner_id=${winnerId ?? white_player_id}
      WHERE tournament_id=${tournament_id} AND round=${round} AND match_index=${match_index}
    `;

    // Save bracket
    await sql`
      UPDATE tournaments SET bracket_json=${JSON.stringify({ bracket, entryRows })}
      WHERE id=${tournament_id}
    `;

    // Schedule the next match or finalize
    await scheduleNextMatch(tournament_id);
  });
}

// ── Finalize ──────────────────────────────────────────────────────────────────

/** Force-finalize a tournament whose bracket is complete but status is still 'running'. */
export async function forceFinalizeIfComplete(tournamentId: string): Promise<boolean> {
  let finalized = false;
  await withScheduleLock(tournamentId, async () => {
    const rows = await sql<TournamentRow[]>`SELECT * FROM tournaments WHERE id=${tournamentId}`;
    const t = rows[0];
    if (!t || !t.bracket_json || t.status !== "running") return;

    const { bracket, entryRows } = JSON.parse(t.bracket_json) as {
      bracket: ReturnType<typeof buildBracket>;
      entryRows: EntryRow[];
    };

    // Rebuild bracket from tournament_games winners (handles race where bracket JSON is stale)
    const tgRows = await sql<{
      round: number; match_index: number;
      white_player_id: string; black_player_id: string; winner_id: string | null;
    }[]>`SELECT round, match_index, white_player_id, black_player_id, winner_id
         FROM tournament_games WHERE tournament_id=${tournamentId}`;

    for (const tg of tgRows) {
      if (!tg.winner_id) continue;
      const m = bracket.rounds[tg.round]?.[tg.match_index];
      if (!m || m.winner !== null) continue;
      const whiteIdx = entryRows.findIndex((e) => e.player_id === tg.white_player_id);
      const blackIdx = entryRows.findIndex((e) => e.player_id === tg.black_player_id);
      const winnerIdx = tg.winner_id === tg.black_player_id ? blackIdx : whiteIdx;
      recordResult(bracket, tg.round, tg.match_index, winnerIdx);
    }

    // Check if bracket is now complete
    const finalMatch = bracket.rounds[bracket.rounds.length - 1]?.[0];
    if (finalMatch?.winner === null || finalMatch?.winner === undefined) return;

    await sql`UPDATE tournaments SET bracket_json=${JSON.stringify({ bracket, entryRows })}
              WHERE id=${tournamentId}`;
    await doFinalize(tournamentId, bracket, entryRows);
    finalized = true;
  });
  return finalized;
}

async function doFinalize(
  tournamentId: string,
  bracket: ReturnType<typeof buildBracket>,
  entryRows: EntryRow[],
): Promise<void> {
  const rows = await sql<TournamentRow[]>`SELECT * FROM tournaments WHERE id=${tournamentId}`;
  const t = rows[0];
  if (!t) return;

  // placements(): { agentId (index), place }
  const places = placements(bracket);

  // Top splitsBps.length players get prizes, but cap at actual placements
  const nPrize    = Math.min(DEFAULT_SPLITS_BPS.length, places.length);
  const pool      = BigInt(t.prize_pool_usdc6 ?? 0);
  // Redistribute splits proportionally across the available prize slots
  const activeBps = DEFAULT_SPLITS_BPS.slice(0, nPrize);
  const bpsTotal  = activeBps.reduce((s, b) => s + b, 0);
  const prizeList = activeBps.map((bps, i) => {
    if (i === nPrize - 1) {
      // Last slot absorbs rounding dust
      const sofar = activeBps.slice(0, i).reduce((s, b) => s + (pool * BigInt(b) / BigInt(bpsTotal)), 0n);
      return pool - sofar;
    }
    return pool * BigInt(bps) / BigInt(bpsTotal);
  });

  // Build placement address array (for on-chain finalize)
  const placementAddrs: string[] = [];
  for (let i = 0; i < nPrize; i++) {
    const place   = places[i];
    const entry   = place ? entryRows[place.agentId] : null;
    const wallet  = entry ? await getPlayerWallet(entry.player_id).catch(() => null) : null;
    placementAddrs.push(wallet?.address ?? "0x0000000000000000000000000000000000000000");

    if (entry) {
      const prize = prizeList[i] ?? 0n;
      await sql`
        UPDATE entries SET placement=${i + 1}, prize_usdc6=${String(prize)}
        WHERE tournament_id=${tournamentId} AND player_id=${entry.player_id}
      `;
    }
  }

  // On-chain finalize
  try {
    await createContractExecution({
      walletId:            cfg.REFEREE_WALLET_ID,
      contractAddress:     cfg.POOL_ADDRESS,
      abiFunctionSignature: POOL_ABI_FINALIZE,
      abiParameters:       [t.chain_tid!, placementAddrs],
      idempotencyKey:      `finalize_tournament_${tournamentId}`,
    });
  } catch (err) {
    console.warn("[tournament] finalize() on-chain failed:", (err as Error).message);
  }

  await sql`
    UPDATE tournaments SET status='done'
    WHERE id=${tournamentId}
  `;

  // Notify
  const champ = champion(bracket);
  const champEntry = champ !== null ? entryRows[champ] : null;
  await redis.publish(`tournament:${tournamentId}`, JSON.stringify({
    type:        "tournament_done",
    tournamentId,
    champion:    champEntry?.player_id ?? null,
    placements:  places.map((p) => ({
      place:     p.place,
      playerId:  entryRows[p.agentId]?.player_id ?? null,
    })),
  }));

  console.log(`[tournament] ${tournamentId} finalized, champion=${champEntry?.player_id}`);
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export async function getTournament(id: string): Promise<TournamentRow | null> {
  const rows = await sql<TournamentRow[]>`SELECT * FROM tournaments WHERE id=${id}`;
  return rows[0] ?? null;
}

export async function listTournaments(status?: string): Promise<TournamentRow[]> {
  if (status) {
    return sql<TournamentRow[]>`
      SELECT * FROM tournaments WHERE status=${status} ORDER BY starts_at DESC LIMIT 20
    `;
  }
  return sql<TournamentRow[]>`
    SELECT * FROM tournaments ORDER BY starts_at DESC LIMIT 20
  `;
}

export async function getTournamentEntries(tournamentId: string): Promise<EntryRow[]> {
  return sql<EntryRow[]>`
    SELECT * FROM entries WHERE tournament_id=${tournamentId} ORDER BY placement NULLS LAST
  `;
}

export async function getTournamentGames(tournamentId: string) {
  return sql<{
    game_id: string; round: number; match_index: number;
    white_player_id: string; black_player_id: string; winner_id: string | null;
  }[]>`
    SELECT game_id, round, match_index, white_player_id, black_player_id, winner_id
    FROM tournament_games WHERE tournament_id=${tournamentId}
    ORDER BY round, match_index
  `;
}

// ── Internal: get wallet for any player kind ──────────────────────────────────

async function getPlayerWallet(playerId: string): Promise<{ address: string; walletId: string }> {
  const rows = await sql<{ address: string; circle_wallet_id: string }[]>`
    SELECT address, circle_wallet_id FROM wallets WHERE owner_id=${playerId} LIMIT 1
  `;
  if (rows[0]) {
    return { address: rows[0].address, walletId: rows[0].circle_wallet_id };
  }
  // Fallback: referee relays
  return { address: cfg.REFEREE_WALLET_ADDRESS ?? "", walletId: cfg.REFEREE_WALLET_ID };
}
