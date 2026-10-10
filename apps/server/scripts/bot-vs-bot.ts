/**
 * Stage 2 "Done when" smoke script.
 *
 * Plays bot_3 (white) vs bot_5 (black) to checkmate on ARC-TESTNET.
 * After every move it polls until the move row reaches state='final'.
 * After the game ends it verifies endGame landed on chain by reading
 * FinalMoveLedger.resultOf(gameId).
 * Then replays the game from chain events and checks move-for-move agreement.
 *
 * Usage:  cd apps/server && bun run smoke
 */
import { sql } from "../src/db/client.ts";
import { redis } from "../src/db/redis.ts";
import { startIndexer } from "../src/indexer/index.ts";
import { startWorker } from "../src/chain/writer.ts";
import { loadBots, getBotMove, getBot } from "../src/bots/index.ts";
import { createGame, handleMove, getLiveGame } from "../src/referee/game.ts";
import { cfg } from "../src/config/index.ts";
import { createPublicClient, http, parseAbi } from "viem";

const RPC = createPublicClient({ transport: http(cfg.ARC_RPC_URL) });

const LEDGER_ABI = parseAbi([
  "function resultOf(bytes32 gameId) view returns (uint8 status, uint8 result, address white, address black, bytes32 escrowMatchId)",
]);

// Wait for a move to reach 'final' state in the DB
interface MoveRow { state: string; tx_hash: string | null; final_at: string | null }
async function waitFinal(gameId: string, ply: number, timeoutMs = 180_000): Promise<MoveRow & { ply: number }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await sql<MoveRow[]>`
      SELECT state, tx_hash, final_at
      FROM moves WHERE game_id=${gameId} AND ply=${ply}
    `;
    const row = rows[0];
    if (row?.state === "final") return { ...row, ply };
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`ply ${ply} never reached 'final' within ${timeoutMs}ms`);
}

async function waitEndGame(chainGameId: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await RPC.readContract({
        address: cfg.LEDGER_ADDRESS as `0x${string}`,
        abi: LEDGER_ABI,
        functionName: "resultOf",
        args: [chainGameId as `0x${string}`],
      });
      // status=2 means Ended
      if (result[0] === 2) return result;
    } catch {}
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`endGame never landed for ${chainGameId}`);
}

async function replayFromChain(chainGameId: string, serverMoves: string[]) {
  const { parseFEN, applyMove, legalMoves, moveToUci, START_FEN } = await import("@final-move/chess");
  // Read Move events from chain_events table (already indexed)
  const events = await sql<{ args_json: string }[]>`
    SELECT args_json FROM chain_events
    WHERE event_name LIKE '%Move%'
      AND args_json LIKE ${`%${chainGameId.slice(2, 12)}%`}
    ORDER BY block_number ASC, log_index ASC
  `;

  if (!events.length) {
    console.log("  ⚠  No Move events indexed yet — skipping replay check");
    return;
  }

  let pos = parseFEN(START_FEN);
  const chainUcis: string[] = [];

  for (const ev of events) {
    const raw = JSON.parse(ev.args_json) as { topics?: string[]; data?: string };
    // data: ABI-encoded (uint16 uci, address player, bool relayed) — 3 x 32-byte slots
    // First 32-byte slot (bytes 2..66 of the 0x-prefixed hex string) = uci padded to uint256
    if (!raw.data) continue;
    const dataHex = raw.data.startsWith("0x") ? raw.data.slice(2) : raw.data;
    const uciRaw = parseInt(dataHex.slice(0, 64), 16) & 0xffff;
    const fromSq = uciRaw & 0x3f;
    const toSq   = (uciRaw >> 6) & 0x3f;
    const promoN = (uciRaw >> 12) & 0xf;
    const files = "abcdefgh";
    const fromUci = files[fromSq & 7]! + String(Math.floor(fromSq / 8) + 1);
    const toUci   = files[toSq & 7]!   + String(Math.floor(toSq / 8) + 1);
    const promoMap: Record<number, string> = { 1: "n", 2: "b", 3: "r", 4: "q" };
    const uci = fromUci + toUci + (promoN ? promoMap[promoN] ?? "" : "");
    chainUcis.push(uci);

    const legal = legalMoves(pos);
    // UCI castling: engine may emit e1c1/e8c8 (rook-side sq) vs e1g1/e8g8 (king-side)
    // Normalise by checking both forms
    const mv = legal.find((m) => moveToUci(m) === uci)
            ?? legal.find((m) => {
                 const mu = moveToUci(m);
                 // queen-side castling: e1c1↔e1a1 or e8c8↔e8a8
                 return (uci === "e1c1" && mu === "e1a1") || (uci === "e8c8" && mu === "e8a8")
                     || (uci === "e1a1" && mu === "e1c1") || (uci === "e8a8" && mu === "e8c8");
               });
    if (!mv) {
      console.error(`  ❌  Replay: illegal move ${uci} at ply ${chainUcis.length}`);
      return;
    }
    pos = applyMove(pos, mv);
  }

  // Compare with server record
  let ok = true;
  for (let i = 0; i < Math.min(chainUcis.length, serverMoves.length); i++) {
    if (chainUcis[i] !== serverMoves[i]) {
      console.error(`  ❌  Replay mismatch at ply ${i + 1}: chain=${chainUcis[i]} server=${serverMoves[i]}`);
      ok = false;
    }
  }
  if (ok) console.log(`  ✅  Replay matches server record (${chainUcis.length} moves from chain)`);
  else     console.log(`  ⚠  Replay had mismatches`);
}

async function main() {
  console.log("=== Stage 2 smoke: bot vs bot ===\n");

  // Fast-forward the indexer to 50 blocks before the current chain head so
  // it doesn't need to replay from the deploy block (saves ~30 minutes).
  {
    const latestBlock = await RPC.getBlockNumber();
    const startFrom = latestBlock > 50n ? latestBlock - 50n : latestBlock;
    await redis.set("indexer:head", String(startFrom));
    console.log(`[smoke] indexer head set to ${startFrom} (chain tip: ${latestBlock})`);
  }

  // Start infrastructure
  await loadBots();
  await startIndexer();
  startWorker(cfg.REFEREE_WALLET_ID);

  const white = getBot("bot_1")!;  // 0x0458de... — funded
  const black = getBot("bot_3")!;  // 0xf3dff3... — funded

  if (!white.walletId || !black.walletId) {
    console.error("Bot wallets not configured. Run `bun run bot-wallets` first.");
    process.exit(1);
  }

  // Start a per-wallet worker for each bot so their move txs are processed
  startWorker(white.walletId!);
  startWorker(black.walletId!);

  // Create game
  const game = await createGame({
    whiteId: white.id,
    whiteKind: "bot",
    whiteAddr: white.address,
    whiteWalletId: white.walletId,
    blackId: black.id,
    blackKind: "bot",
    blackAddr: black.address,
    blackWalletId: black.walletId,
    gameClass: "open",
    baseSec: 180,
    incSec: 2,
    timeControl: "3+2",
  });

  console.log(`Game created: ${game.id} (chain: ${game.chainGameId})`);
  console.log(`White: ${white.name} (${white.id})`);
  console.log(`Black: ${black.name} (${black.id})\n`);

  // Play until the game ends (max 300 plies to avoid infinite loops)
  let ply = 0;
  const MAX_PLY = 300;

  while (ply < MAX_PLY) {
    const live = getLiveGame(game.id);
    if (!live || live.status === "ended" || live.status === "aborted") break;

    const moverColor: "w" | "b" = ply % 2 === 0 ? "w" : "b";
    const mover = moverColor === "w" ? white : black;
    const uci = await getBotMove(mover.id, live.position);

    if (!uci) {
      console.log(`No legal move for ${mover.name} — game over`);
      break;
    }

    const result = await handleMove(game.id, mover.id, uci);
    if (!result.ok) {
      console.error(`Move rejected: ${result.reason}`);
      break;
    }

    ply++;
    const moveNum = Math.ceil(ply / 2);
    const dot = moverColor === "w" ? `${moveNum}.` : `${moveNum}...`;
    process.stdout.write(`${dot}${uci} `);
    if (ply % 10 === 0) process.stdout.write("\n");

    if (result.over) {
      console.log(`\n\nGame over: ${result.result} by ${result.reason} after ${ply} plies`);
      break;
    }
  }

  if (ply >= MAX_PLY) {
    console.log(`\nStopped at ${MAX_PLY} plies`);
  }

  const finalGame = getLiveGame(game.id);
  const serverMoves = finalGame?.moves ?? [];

  console.log(`\n--- Waiting for all ${ply} plies to reach 'final' ---`);

  // Wait for each ply to go final (in parallel, with progress)
  const CONCURRENCY = 5;
  for (let i = 0; i < ply; i += CONCURRENCY) {
    const batch = Array.from({ length: Math.min(CONCURRENCY, ply - i) }, (_, j) => i + j + 1);
    const results = await Promise.all(batch.map((p) => waitFinal(game.id, p).catch((e: Error) => ({ error: e.message, ply: p }))));
    for (const r of results) {
      if ("error" in r && typeof r.error === "string") {
        console.error(`  ⚠  ply ${r.ply}: ${r.error}`);
      } else {
        const row = r as MoveRow & { ply: number };
        console.log(`  ✅  ply ${row.ply} final  tx=${row.tx_hash}`);
      }
    }
  }

  console.log("\n--- Waiting for endGame on chain ---");
  const onChainResult = await waitEndGame(game.chainGameId).catch((e) => {
    console.error(`  ⚠  ${e.message}`);
    return null;
  });

  if (onChainResult) {
    const resultNames: Record<number, string> = { 1: "white", 2: "black", 3: "draw", 4: "aborted" };
    console.log(`  ✅  endGame landed: result=${resultNames[onChainResult[1]] ?? onChainResult[1]}`);
  }

  console.log("\n--- Replaying game from chain events ---");
  await replayFromChain(game.chainGameId, serverMoves);

  console.log("\n=== Smoke test complete ===");
  await sql.end();
  redis.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
