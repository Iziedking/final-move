/**
 * Arc chain indexer.
 * Reads FinalMoveLedger + MatchEscrow + TournamentPool events.
 * Idempotent on (txHash, logIndex). Marks moves "final" once their Move event lands.
 * Exposes lagBlocks for /health.
 */
import { createPublicClient, http, type Log, keccak256, toBytes } from "viem";
import { sql } from "../db/client.ts";
import { cfg } from "../config/index.ts";
import { redis } from "../db/redis.ts";

const INDEXER_HEAD_KEY = "indexer:head";
const CATCH_UP_BATCH = 1_000n;  // larger batches while catching up
const LIVE_BATCH     =   200n;  // smaller batches near the head to avoid rate limits
const CATCH_UP_GAP   = 5_000n;  // switch to live mode when within this many blocks of head
const POLL_MS        = 4_000;   // poll interval

// Use RPC proxy if available (Arc_Testnet key), fall back to public RPC
const proxyChains = (process.env.RPC_PROXY_CHAINS ?? "").split(",").map((s) => s.trim());
const rpcUrl = process.env.RPC_PROXY_BASE_URL && proxyChains.includes("Arc_Testnet")
  ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
  : cfg.ARC_RPC_URL;

const client = createPublicClient({
  transport: http(rpcUrl),
});

// Contract ABIs are intentionally not decoded in v1 indexer (raw log storage).
// We identify events by topic0 and store raw JSON for replay/audit.

// ── Lag tracking ──────────────────────────────────────────────────────────────

let lagBlocks = 0;
export function getIndexerLag(): number { return lagBlocks; }

// ── Main loop ─────────────────────────────────────────────────────────────────

export async function startIndexer() {
  console.log("[indexer] starting");
  loop().catch((e) => console.error("[indexer] fatal:", e));
}

async function loop() {
  for (;;) {
    try {
      const wasCatchUp = await tickOnce();
      if (wasCatchUp) continue; // skip poll delay during catch-up
    } catch (e) {
      console.error("[indexer] tick error:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function tick() {
  const headBlock = await client.getBlockNumber();
  const fromStr   = await redis.get(INDEXER_HEAD_KEY);
  const from      = fromStr ? BigInt(fromStr) : cfg.DEPLOY_BLOCK;

  if (from > headBlock) {
    lagBlocks = 0;
    return;
  }

  // Use a larger batch when catching up; smaller near the tip to avoid rate limits
  const catchingUp = (headBlock - from) > CATCH_UP_GAP;
  const batchSize  = catchingUp ? CATCH_UP_BATCH : LIVE_BATCH;
  const to         = from + batchSize > headBlock ? headBlock : from + batchSize;

  lagBlocks = Number(headBlock - to);

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Query contracts sequentially with a small delay between each to avoid rate limits
  const addresses = [cfg.LEDGER_ADDRESS, cfg.ESCROW_ADDRESS, cfg.POOL_ADDRESS] as `0x${string}`[];
  const allLogs: import("viem").Log[] = [];
  for (const address of addresses) {
    try {
      const logs = await client.getLogs({ address, fromBlock: from, toBlock: to });
      allLogs.push(...logs);
    } catch (e) {
      console.warn(`[indexer] getLogs ${address} failed:`, (e as Error).message);
    }
    if (!catchingUp) await delay(300);
  }

  for (const log of allLogs) {
    await processLog(log);
  }

  await redis.set(INDEXER_HEAD_KEY, String(to + 1n));
}

// Returns true when we processed a catch-up batch (caller should not wait)
async function tickOnce(): Promise<boolean> {
  const headBlock = await client.getBlockNumber();
  const fromStr   = await redis.get(INDEXER_HEAD_KEY);
  const from      = fromStr ? BigInt(fromStr) : cfg.DEPLOY_BLOCK;
  if (from > headBlock) { lagBlocks = 0; return false; }
  const catchingUp = (headBlock - from) > CATCH_UP_GAP;
  await tick();
  return catchingUp && lagBlocks > 0;
}

async function processLog(log: Log) {
  const txHash   = log.transactionHash ?? "";
  const logIndex = Number(log.logIndex ?? 0);

  // Idempotency check
  const existing = await sql`
    SELECT id FROM chain_events WHERE tx_hash=${txHash} AND log_index=${logIndex}
  `;
  if (existing.length) return;

  // Decode event name from topic0
  const topic0 = log.topics[0];
  const eventName = decodeEventName(topic0);

  // Persist raw event — serialize BigInt fields as strings
  const argsJson = JSON.stringify(log, (_k, v) => typeof v === "bigint" ? v.toString() : v);
  await sql`
    INSERT INTO chain_events (tx_hash, log_index, block_number, contract, event_name, args_json)
    VALUES (${txHash}, ${logIndex}, ${String(log.blockNumber ?? 0)}, ${(log.address ?? "").toLowerCase()}, ${eventName}, ${argsJson})
    ON CONFLICT DO NOTHING
  `;

  // Handle Move events → mark row final
  if (eventName === "Move" || eventName === "move") {
    await handleMoveLog(log, txHash);
  }
}

async function handleMoveLog(log: Log, txHash: string) {
  try {
    // topics: [topic0=sig, topic1=gameId(indexed bytes32), topic2=ply(indexed uint16)]
    // data: ABI-encoded (uint16 uci, address player, bool relayed) = 3 x 32-byte slots
    const gameIdHex = log.topics[1] ?? "";
    const plyHex    = log.topics[2] ?? "";
    // topics are 32-byte padded — use BigInt to avoid parseInt overflow on long hex strings
    const ply = Number(BigInt(plyHex || "0x0"));

    // Get block time
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
    // Always set tx_hash here (writer may have polled before the tx landed).
    // COALESCE keeps any existing hash in case it was already written.
    await sql`
      UPDATE moves
      SET state    = 'final',
          block    = ${String(log.blockNumber ?? 0)},
          final_at = ${blockTime?.toISOString() ?? null},
          tx_hash  = COALESCE(tx_hash, ${txHash})
      WHERE id = ${row.id} AND state NOT IN ('final')
    `;

    // Broadcast final update
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

// topic0 keccak256 → event name, computed from the exact signatures in our contracts.

// FinalMoveLedger events (exact Solidity signatures — no spaces, enum as uint8)
//   event Move(bytes32 indexed gameId, uint16 indexed ply, uint16 uci, address player, bool relayed)
//   event GameCreated(bytes32 indexed gameId, address indexed white, address indexed black,
//                     uint8 gameClass, uint32 baseSec, uint16 incSec, bytes32 escrowMatchId)
//   event GameEnded(bytes32 indexed gameId, uint8 result, uint8 reason, uint16 totalPlies, bytes32 finalFenHash)
// MatchEscrow events
//   event Deposited(bytes32 indexed matchId, address player)
//   event MatchSettled(bytes32 indexed matchId, address winner, uint256 payout)
//   event MatchOpened(bytes32 indexed matchId, bytes32 gameId, address playerA, address playerB, uint256 amount, uint64 fundDeadline)
//   event MatchCancelled(bytes32 indexed matchId)
// TournamentPool events
//   event TournamentCreated(bytes32 indexed tid, uint256 entryFee, uint64 regClose)
//   event Funded(bytes32 indexed tid, address indexed funder, uint256 amount)
//   event Finalized(bytes32 indexed tid, address[] placements, uint256[] amounts)

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
