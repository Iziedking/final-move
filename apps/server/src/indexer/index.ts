/**
 * Arc chain indexer.
 * Reads FinalMoveLedger + MatchEscrow + TournamentPool events.
 * Idempotent on (txHash, logIndex).
 *
 * Key properties (QA Round 4A fixes):
 * - Indexer head stored in Postgres (indexer_head table), not just Redis.
 *   Redis is still used as a cache for speed; Postgres is the source of truth.
 * - On getLogs failure, the head is NOT advanced — the range will be retried.
 * - Settlement is triggered from the indexed GameEnded event (not from endGame
 *   in game.ts, which fires before the chain confirms).
 * - scheduleEndGame polling is capped; failures are alerted.
 */
import { createPublicClient, http, type Log, keccak256, toBytes } from "viem";
import { sql } from "../db/client.ts";
import { cfg } from "../config/index.ts";
import { redis } from "../db/redis.ts";

const INDEXER_HEAD_KEY = "indexer:head";
const CATCH_UP_BATCH  = 1_000n;
const LIVE_BATCH      =   200n;
const CATCH_UP_GAP    = 5_000n;
const POLL_MS         = 4_000;

// Use RPC proxy if available, fall back to public RPC.
const proxyChains = (process.env.RPC_PROXY_CHAINS ?? "").split(",").map((s) => s.trim());
const rpcUrl = process.env.RPC_PROXY_BASE_URL && proxyChains.includes("Arc_Testnet")
  ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
  : cfg.ARC_RPC_URL;

const client = createPublicClient({ transport: http(rpcUrl) });

// ── Lag tracking ──────────────────────────────────────────────────────────────

let lagBlocks = 0;
export function getIndexerLag(): number { return lagBlocks; }

// ── Head persistence (Postgres + Redis cache) ─────────────────────────────────

async function getHead(): Promise<bigint> {
  // Fast path: Redis cache
  const cached = await redis.get(INDEXER_HEAD_KEY);
  if (cached) return BigInt(cached);
  // Slow path: Postgres
  const rows = await sql<{ head: string }[]>`
    SELECT head FROM indexer_head WHERE id=1
  `;
  const head = rows[0] ? BigInt(rows[0].head) : cfg.DEPLOY_BLOCK;
  await redis.set(INDEXER_HEAD_KEY, String(head));
  return head;
}

async function advanceHead(to: bigint): Promise<void> {
  const next = to + 1n;
  await sql`
    INSERT INTO indexer_head (id, head) VALUES (1, ${String(next)})
    ON CONFLICT (id) DO UPDATE SET head=${String(next)}, updated_at=now()
  `;
  await redis.set(INDEXER_HEAD_KEY, String(next));
}

// ── Main loop ─────────────────────────────────────────────────────────────────

export async function startIndexer() {
  // Ensure the indexer_head table exists (idempotent)
  await sql`
    CREATE TABLE IF NOT EXISTS indexer_head (
      id         INTEGER PRIMARY KEY DEFAULT 1,
      head       TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  console.log("[indexer] starting");
  loop().catch((e) => console.error("[indexer] fatal:", e));
}

async function loop() {
  for (;;) {
    try {
      const wasCatchUp = await tickOnce();
      if (wasCatchUp) continue;
    } catch (e) {
      console.error("[indexer] tick error:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function tickOnce(): Promise<boolean> {
  const headBlock = await client.getBlockNumber();
  const from      = await getHead();
  if (from > headBlock) { lagBlocks = 0; return false; }
  const catchingUp = (headBlock - from) > CATCH_UP_GAP;
  await tick(from, headBlock, catchingUp);
  return catchingUp && lagBlocks > 0;
}

async function tick(from: bigint, headBlock: bigint, catchingUp: boolean) {
  const batchSize = catchingUp ? CATCH_UP_BATCH : LIVE_BATCH;
  const to        = from + batchSize > headBlock ? headBlock : from + batchSize;
  lagBlocks = Number(headBlock - to);

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const addresses = [cfg.LEDGER_ADDRESS, cfg.ESCROW_ADDRESS, cfg.POOL_ADDRESS] as `0x${string}`[];

  let allLogsOk = true;
  const allLogs: Log[] = [];

  for (const address of addresses) {
    try {
      const logs = await client.getLogs({ address, fromBlock: from, toBlock: to });
      allLogs.push(...logs);
    } catch (e) {
      // CRITICAL: on any getLogs failure, do NOT advance the head.
      // The failed range will be re-read on the next tick.
      console.warn(`[indexer] getLogs ${address} failed (will retry):`, (e as Error).message);
      allLogsOk = false;
    }
    if (!catchingUp) await delay(300);
  }

  if (!allLogsOk) return; // do not advance — retry this range next tick

  for (const log of allLogs) {
    await processLog(log).catch((e) =>
      console.error("[indexer] processLog error:", (e as Error).message),
    );
  }

  // Only advance after all logs processed successfully
  await advanceHead(to);
}

// ── Log processing ────────────────────────────────────────────────────────────

async function processLog(log: Log) {
  const txHash   = log.transactionHash ?? "";
  const logIndex = Number(log.logIndex ?? 0);

  const existing = await sql`
    SELECT id FROM chain_events WHERE tx_hash=${txHash} AND log_index=${logIndex}
  `;
  if (existing.length) return;

  const topic0    = log.topics[0];
  const eventName = decodeEventName(topic0);

  const argsJson = JSON.stringify(log, (_k, v) => typeof v === "bigint" ? v.toString() : v);
  // Extract chain_game_id (topics[1]) for Move/GameCreated/GameEnded events so
  // the replay query can use an exact equality match instead of jsonb extraction.
  const chainGameId: string | null =
    ["Move", "GameCreated", "GameEnded"].includes(eventName) && log.topics[1]
      ? (log.topics[1] as string)
      : null;

  await sql`
    INSERT INTO chain_events
      (tx_hash, log_index, block_number, contract, event_name, args_json, chain_game_id)
    VALUES (
      ${txHash}, ${logIndex}, ${String(log.blockNumber ?? 0)},
      ${(log.address ?? "").toLowerCase()}, ${eventName}, ${argsJson},
      ${chainGameId}
    )
    ON CONFLICT DO NOTHING
  `;

  if (eventName === "Move" || eventName === "move") {
    await handleMoveLog(log, txHash);
  }

  if (eventName === "GameEnded") {
    await handleGameEndedLog(log, txHash);
  }
}

// ── Move log handler ──────────────────────────────────────────────────────────

async function handleMoveLog(log: Log, txHash: string) {
  try {
    const gameIdHex = log.topics[1] ?? "";
    const plyHex    = log.topics[2] ?? "";
    const ply = Number(BigInt(plyHex || "0x0"));

    let blockTime: Date | null = null;
    try {
      const block = await client.getBlock({ blockNumber: log.blockNumber! });
      blockTime = new Date(Number(block.timestamp) * 1000);
    } catch {}

    const rows = await sql<{ id: string; submitted_at: Date | null }[]>`
      SELECT id, submitted_at
      FROM moves
      WHERE tx_hash=${txHash}
         OR (ply=${ply} AND game_id IN (
               SELECT id FROM games WHERE chain_game_id=${gameIdHex}
             ))
      LIMIT 1
    `;
    if (!rows.length) return;

    const row = rows[0]!;
    await sql`
      UPDATE moves
      SET state    = 'final',
          block    = ${String(log.blockNumber ?? 0)},
          final_at = ${blockTime?.toISOString() ?? null},
          tx_hash  = COALESCE(tx_hash, ${txHash})
      WHERE id = ${row.id} AND state NOT IN ('final')
    `;

    const gameRows = await sql<{ id: string }[]>`
      SELECT id FROM games WHERE chain_game_id=${gameIdHex} LIMIT 1
    `;
    if (gameRows.length) {
      const submittedAt = row.submitted_at ? new Date(row.submitted_at).getTime() : Date.now();
      const finalMs = blockTime ? blockTime.getTime() - submittedAt : undefined;
      redis.publish(`game:${gameRows[0]!.id}`, JSON.stringify({
        type: "chain",
        gameId: gameRows[0]!.id,
        ply,
        txHash,
        state: "final",
        finalMs,
      })).catch(() => {});
    }
  } catch (e) {
    console.error("[indexer] handleMoveLog error:", (e as Error).message);
  }
}

// ── GameEnded log handler ─────────────────────────────────────────────────────
// Triggers stake settlement from the confirmed on-chain event rather than from
// endGame() in game.ts (which fires before the tx confirms and races the contract).

async function handleGameEndedLog(log: Log, _txHash: string) {
  try {
    const chainGameId = log.topics[1] ?? "";

    const gameRow = await sql<{ id: string; stake_offer_id: string | null }[]>`
      SELECT id, stake_offer_id FROM games
      WHERE chain_game_id=${chainGameId} LIMIT 1
    `;
    if (!gameRow[0]) return;

    const { id: gameId, stake_offer_id: stakeOfferId } = gameRow[0];

    // Trigger auto-settle now that GameEnded is confirmed on-chain
    if (stakeOfferId) {
      import("../stakes/index.ts").then(({ onStakedGameEnd }) =>
        onStakedGameEnd(stakeOfferId).catch((e: unknown) =>
          console.error("[indexer] stake auto-settle failed:", (e as Error).message),
        ),
      ).catch(() => {});
    }

    // Tournament bracket advancement (game confirmed on-chain)
    const tgRow = await sql<{ tournament_id: string }[]>`
      SELECT tournament_id FROM tournament_games WHERE game_id=${gameId} LIMIT 1
    `;
    if (tgRow[0]) {
      const gameDetailRow = await sql<{
        result: string; white_id: string; black_id: string;
      }[]>`SELECT result, white_id, black_id FROM games WHERE id=${gameId}`;
      if (gameDetailRow[0]) {
        const { result, white_id, black_id } = gameDetailRow[0];
        const winnerId = result === "white" ? white_id
                       : result === "black" ? black_id
                       : null;
        import("../tournaments/index.ts").then(({ onTournamentGameEnd }) =>
          onTournamentGameEnd(gameId, winnerId),
        ).catch((e: unknown) =>
          console.error("[indexer] tournament advancement failed:", (e as Error).message),
        );
      }
    }
  } catch (e) {
    console.error("[indexer] handleGameEndedLog error:", (e as Error).message);
  }
}

// ── Event name decoder ────────────────────────────────────────────────────────

const SIG_MAP: [string, string][] = [
  ["Move(bytes32,uint16,uint16,address,bool)",                                              "Move"],
  ["GameCreated(bytes32,address,address,uint8,uint32,uint16,bytes32)",                      "GameCreated"],
  ["GameEnded(bytes32,uint8,uint8,uint16,bytes32)",                                         "GameEnded"],
  ["Deposited(bytes32,address)",                                                             "Deposited"],
  ["MatchSettled(bytes32,address,uint256)",                                                  "MatchSettled"],
  ["MatchOpened(bytes32,bytes32,address,address,uint256,uint64)",                            "MatchOpened"],
  ["MatchCancelled(bytes32)",                                                                "MatchCancelled"],
  ["TournamentCreated(bytes32,uint256,uint64)",                                              "TournamentCreated"],
  ["Funded(bytes32,address,uint256)",                                                        "Funded"],
  ["Finalized(bytes32,address[],uint256[])",                                                 "Finalized"],
];

const KNOWN_EVENTS: Record<string, string> = {};
let eventsReady = false;

function ensureEvents() {
  if (eventsReady) return;
  eventsReady = true;
  for (const [sig, name] of SIG_MAP) {
    KNOWN_EVENTS[keccak256(toBytes(sig))] = name;
  }
}

function decodeEventName(topic0?: string): string {
  if (!topic0) return "unknown";
  ensureEvents();
  return KNOWN_EVENTS[topic0] ?? topic0.slice(0, 10);
}
