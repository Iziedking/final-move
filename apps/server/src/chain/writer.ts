/**
 * Chain writer: one BullMQ queue per wallet address, so nonces never collide.
 * Each job writes a single move (or relay) to FinalMoveLedger via Circle.
 */
import { Queue, Worker, Job } from "bullmq";
import { redis } from "../db/redis.ts";
import { sql } from "../db/client.ts";
import { cfg } from "../config/index.ts";
import {
  createContractExecution,
  pollTx,
  uuidV5,
  type CircleTx,
} from "./circle.ts";
// Import lazily to avoid circular dependency (game.ts also imports writer.ts)
async function getMarkChainLive() {
  const { markChainLive } = await import("../referee/game.ts");
  return markChainLive;
}

// ── ABI snippets ──────────────────────────────────────────────────────────────

const MOVE_SIG     = "move(bytes32,uint16,uint16)";
const RELAY_SIG    = "relayMove(bytes32,uint16,uint16)";
const END_SIG      = "endGame(bytes32,uint8,uint8,uint16,bytes32)";
const CREATE_SIG   = "createGame(bytes32,address,address,uint8,uint32,uint16,bytes32)";

// ── Queue factory (one queue per walletId) ────────────────────────────────────

const queues = new Map<string, Queue>();
const workers = new Map<string, Worker>();

function queueName(walletId: string) {
  return `chain-${walletId.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

export function getWalletQueue(walletId: string): Queue {
  if (!queues.has(walletId)) {
    const q = new Queue(queueName(walletId), {
      connection: redis,
      defaultJobOptions: {
        attempts: 4,
        backoff: { type: "exponential", delay: 8_000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
    queues.set(walletId, q);
  }
  return queues.get(walletId)!;
}

// ── Job shapes ────────────────────────────────────────────────────────────────

export type ChainJob =
  | { kind: "move";    gameId: string; ply: number; uci: string; walletId: string; moveRowId: string }
  | { kind: "relay";   gameId: string; ply: number; uci: string; moveRowId: string }
  | { kind: "endGame"; gameId: string; result: number; reasonCode: number; totalPlies: number; fenHash: string }
  | { kind: "createGame"; gameId: string; whiteAddr: string; blackAddr: string; gameClass: number;
      baseSec: number; incSec: number; escrowMatchId: string };

// ── Worker factory ────────────────────────────────────────────────────────────

export function startWorker(walletId: string): Worker {
  if (workers.has(walletId)) return workers.get(walletId)!;

  const worker = new Worker<ChainJob>(
    queueName(walletId),
    async (job: Job<ChainJob>) => {
      await processChainJob(job.data, walletId, job.attemptsMade);
    },
    {
      connection: redis,
      concurrency: 1, // one in-flight tx per wallet — no nonce collision
    },
  );

  worker.on("failed", async (job, err) => {
    console.error(`[chain:worker:${walletId}] job ${job?.id} failed:`, err.message);
    // After all retries exhausted, auto-relay move jobs from the referee wallet
    if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
      const data = job.data as ChainJob;
      if (data.kind === "move") {
        console.log(`[chain:writer] auto-relaying ply ${data.ply} of game ${data.gameId} via referee`);
        const q = getWalletQueue(cfg.REFEREE_WALLET_ID);
        await q.add("relay", {
          kind: "relay",
          gameId: data.gameId,
          ply: data.ply,
          uci: data.uci,
          moveRowId: data.moveRowId,
        } satisfies ChainJob, {
          jobId: uuidV5(`relay:${data.gameId}:${data.ply}`),
          attempts: 2,
          backoff: { type: "exponential", delay: 8_000 },
        });
        startWorker(cfg.REFEREE_WALLET_ID);
      }
    }
  });

  workers.set(walletId, worker);
  return worker;
}

// ── Core job processor ────────────────────────────────────────────────────────

async function processChainJob(data: ChainJob, walletId: string, attempt = 0) {
  switch (data.kind) {
    case "move":       return processMoveJob(data, walletId, attempt);
    case "relay":      return processRelayJob(data, attempt);
    case "endGame":    return processEndGameJob(data, attempt);
    case "createGame": return processCreateGameJob(data, attempt);
  }
}

/** Build an idempotency key that changes on each retry attempt so a FAILED tx
 *  can be resubmitted.  A previously-FAILED tx cannot be retried with the same
 *  key — Circle will return the old FAILED state immediately.
 *  attempt=0 → original submission; attempt=1,2,... → resubmissions.
 */
function idempKey(base: string, attempt: number): string {
  return uuidV5(attempt === 0 ? base : `${base}:retry${attempt}`);
}

async function processMoveJob(
  data: Extract<ChainJob, { kind: "move" }>,
  walletId: string,
  attempt = 0,
) {
  const key = idempKey(`move:${data.gameId}:${data.ply}`, attempt);
  const uciEncoded = encodeUci(data.uci);
  const plyU16 = data.ply;
  const gameIdBytes32 = toBytes32(data.gameId);

  // Mark submitted
  await sql`UPDATE moves SET state='submitted', submitted_at=now() WHERE id=${data.moveRowId}`;

  let tx: CircleTx;
  try {
    tx = await createContractExecution({
      idempotencyKey: key,
      walletId,
      contractAddress: cfg.LEDGER_ADDRESS,
      abiFunctionSignature: MOVE_SIG,
      abiParameters: [gameIdBytes32, plyU16, uciEncoded],
      feeLevel: "HIGH",
    });
  } catch (e) {
    await sql`UPDATE moves SET state='failed' WHERE id=${data.moveRowId}`;
    throw e;
  }

  await sql`UPDATE moves SET circle_tx_id=${tx.id}, state='sent', sent_at=now() WHERE id=${data.moveRowId}`;

  // Poll for completion (webhook may beat us — idempotent update).
  const final = await pollTx(tx.id, 60_000);
  if (final.state === "COMPLETE") {
    // Always write tx_hash and complete_at (the indexer doesn't set these).
    // Guard only the state transition: never downgrade "final" → "complete".
    await sql`
      UPDATE moves
      SET tx_hash    = COALESCE(tx_hash, ${final.txHash ?? null}),
          complete_at = COALESCE(complete_at, now()),
          state       = CASE WHEN state = 'final' THEN 'final' ELSE 'complete' END
      WHERE id = ${data.moveRowId}
    `;
    broadcastChainUpdate(data.gameId, data.ply, final.txHash ?? "", "complete");
  } else {
    await sql`UPDATE moves SET state='failed' WHERE id=${data.moveRowId} AND state <> 'final'`;
    // Re-throw so BullMQ retries; on 3rd failure the relay path kicks in
    throw new Error(`tx ${tx.id} ended ${final.state}`);
  }
}

async function processRelayJob(data: Extract<ChainJob, { kind: "relay" }>, attempt = 0) {
  const key = idempKey(`relay:${data.gameId}:${data.ply}`, attempt);
  const tx = await createContractExecution({
    idempotencyKey: key,
    walletId: cfg.REFEREE_WALLET_ID,
    contractAddress: cfg.LEDGER_ADDRESS,
    abiFunctionSignature: RELAY_SIG,
    abiParameters: [toBytes32(data.gameId), data.ply, encodeUci(data.uci)],
    feeLevel: "HIGH",
  });

  await sql`UPDATE moves SET circle_tx_id=${tx.id}, state='sent', relayed=true WHERE id=${data.moveRowId}`;
  const final = await pollTx(tx.id, 60_000);

  if (final.state === "COMPLETE") {
    await sql`
      UPDATE moves
      SET tx_hash    = COALESCE(tx_hash, ${final.txHash ?? null}),
          complete_at = COALESCE(complete_at, now()),
          state       = CASE WHEN state = 'final' THEN 'final' ELSE 'complete' END
      WHERE id = ${data.moveRowId}
    `;
  } else {
    throw new Error(`relay tx ${tx.id} ended ${final.state}`);
  }
}

async function processEndGameJob(data: Extract<ChainJob, { kind: "endGame" }>, _attempt = 0) {
  const idempKey = uuidV5(`endGame:${data.gameId}`);
  const tx = await createContractExecution({
    idempotencyKey: idempKey,
    walletId: cfg.REFEREE_WALLET_ID,
    contractAddress: cfg.LEDGER_ADDRESS,
    abiFunctionSignature: END_SIG,
    abiParameters: [
      toBytes32(data.gameId),
      data.result,
      data.reasonCode,
      data.totalPlies,
      toBytes32(data.fenHash),
    ],
    feeLevel: "HIGH",
  });

  const final = await pollTx(tx.id, 120_000);
  if (final.state !== "COMPLETE") throw new Error(`endGame tx ${tx.id} ended ${final.state}`);

  // Preserve the status already written by endGame/abortGame — only set 'ended'
  // for genuine wins/draws; aborted games stay 'aborted'.
  await sql`
    UPDATE games
    SET status = CASE WHEN status = 'aborted' THEN 'aborted' ELSE 'ended' END
    WHERE chain_game_id = ${data.gameId}
      AND status NOT IN ('ended', 'aborted')
  `;
  console.log(`[writer] endGame ok game=${data.gameId} tx=${final.txHash}`);
}

async function processCreateGameJob(
  data: Extract<ChainJob, { kind: "createGame" }>,
  attempt = 0,
) {
  const key = idempKey(`createGame:${data.gameId}`, attempt);
  let tx: CircleTx;
  try {
    tx = await createContractExecution({
      idempotencyKey: key,
      walletId: cfg.REFEREE_WALLET_ID,
      contractAddress: cfg.LEDGER_ADDRESS,
      abiFunctionSignature: CREATE_SIG,
      abiParameters: [
        toBytes32(data.gameId),
        data.whiteAddr,
        data.blackAddr,
        data.gameClass,
        data.baseSec,
        data.incSec,
        toBytes32(data.escrowMatchId),
      ],
      feeLevel: "HIGH",
    });
  } catch (err) {
    // Permanent submission error — abort the game so it doesn't hang forever
    console.error(`[writer] createGame submit failed game=${data.gameId}:`, (err as Error).message);
    await abortGameOnChainFail(data.gameId, "createGame_submit_failed");
    return; // don't rethrow — no point retrying a submission error
  }

  const final = await pollTx(tx.id, 60_000);
  if (final.state !== "COMPLETE") {
    console.error(`[writer] createGame tx ${tx.id} ended ${final.state} — aborting game ${data.gameId}`);
    await abortGameOnChainFail(data.gameId, `createGame_tx_${final.state}`);
    throw new Error(`createGame tx ended ${final.state}`); // trigger BullMQ retry
  }
  console.log(`[writer] createGame ok game=${data.gameId} tx=${final.txHash}`);
  // Notify referee so buffered moves are flushed
  const markChainLive = await getMarkChainLive();
  await markChainLive(data.gameId);
}

/** DB-level abort when the createGame chain tx fails permanently.
 *  The referee's in-memory game may already be gone; this just ensures the DB is clean.
 */
async function abortGameOnChainFail(gameId: string, reason: string): Promise<void> {
  try {
    await sql`
      UPDATE games
      SET status='aborted', result='aborted', reason=${reason}, ended_at=now()
      WHERE id=${gameId} AND status NOT IN ('ended','aborted')
    `;
    await redis.publish(`game:${gameId}`, JSON.stringify({
      type: "game_end", gameId, result: "aborted", reason,
    }));
  } catch (e) {
    console.error(`[writer] abortGameOnChainFail error:`, (e as Error).message);
  }
}

// ── Webhook handler (called from HTTP route) ──────────────────────────────────

export async function handleWebhook(payload: unknown) {
  // Circle sends { notificationType, notification: { transaction: CircleTx } }
  const body = payload as {
    notificationType: string;
    notification?: { transaction?: CircleTx };
  };
  if (body.notificationType !== "transactions.outbound") return;
  const tx = body.notification?.transaction;
  if (!tx) return;
  await applyTxState(tx);
}

export async function applyTxState(tx: CircleTx) {
  if (!tx.id) return;
  const rows = await sql<{ id: string; game_id: string; ply: number }[]>`
    SELECT id, game_id, ply FROM moves WHERE circle_tx_id = ${tx.id}
  `;
  if (!rows.length) return;
  const row = rows[0]!;

  if (tx.state === "SENT") {
    await sql`UPDATE moves SET state='sent', sent_at=now() WHERE id=${row.id} AND state <> 'final'`;
  } else if (tx.state === "COMPLETE") {
    await sql`
      UPDATE moves
      SET tx_hash    = COALESCE(tx_hash, ${tx.txHash ?? null}),
          complete_at = COALESCE(complete_at, now()),
          state       = CASE WHEN state = 'final' THEN 'final' ELSE 'complete' END
      WHERE id = ${row.id}
    `;
    broadcastChainUpdate(row.game_id, row.ply, tx.txHash ?? "", "complete");
  } else if (["FAILED", "DENIED", "CANCELLED"].includes(tx.state)) {
    await sql`UPDATE moves SET state='failed' WHERE id=${row.id} AND state <> 'final'`;
  }
}

// ── Enqueue helpers ───────────────────────────────────────────────────────────

export async function enqueueMoveJob(
  walletId: string,
  job: Extract<ChainJob, { kind: "move" }>,
) {
  const q = getWalletQueue(walletId);
  await q.add("move", job, { jobId: uuidV5(`move:${job.gameId}:${job.ply}`) });
  startWorker(walletId);
}

export async function enqueueRelayJob(job: Extract<ChainJob, { kind: "relay" }>) {
  const q = getWalletQueue(cfg.REFEREE_WALLET_ID);
  await q.add("relay", job, { jobId: uuidV5(`relay:${job.gameId}:${job.ply}`) });
  startWorker(cfg.REFEREE_WALLET_ID);
}

export async function enqueueEndGame(job: Extract<ChainJob, { kind: "endGame" }>) {
  const q = getWalletQueue(cfg.REFEREE_WALLET_ID);
  await q.add("endGame", job, { jobId: uuidV5(`endGame:${job.gameId}`) });
  startWorker(cfg.REFEREE_WALLET_ID);
}

export async function enqueueCreateGame(job: Extract<ChainJob, { kind: "createGame" }>) {
  const q = getWalletQueue(cfg.REFEREE_WALLET_ID);
  await q.add("createGame", job, { jobId: uuidV5(`createGame:${job.gameId}`) });
  startWorker(cfg.REFEREE_WALLET_ID);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Encode a UCI string to the uint16 format: from | (to << 6) | (promo << 12) */
function encodeUci(uci: string): number {
  const files: Record<string, number> = { a:0, b:1, c:2, d:3, e:4, f:5, g:6, h:7 };
  const from = (Number(uci[1]) - 1) * 8 + files[uci[0]!]!;
  const to   = (Number(uci[3]) - 1) * 8 + files[uci[2]!]!;
  const promoMap: Record<string, number> = { n:1, b:2, r:3, q:4 };
  const promo = uci[4] ? (promoMap[uci[4]] ?? 0) : 0;
  return from | (to << 6) | (promo << 12);
}

/** Pad a short string (e.g. game id) to a bytes32 hex string */
function toBytes32(val: string): string {
  if (val.startsWith("0x")) return val.padEnd(66, "0");
  const hex = Buffer.from(val.slice(0, 32)).toString("hex").padStart(64, "0");
  return "0x" + hex;
}

// ── Pub/sub broadcast (Redis) ─────────────────────────────────────────────────

function broadcastChainUpdate(gameId: string, ply: number, txHash: string, state: string) {
  redis.publish(
    `game:${gameId}`,
    JSON.stringify({ type: "chain", gameId, ply, txHash, state }),
  ).catch(() => {});
}
