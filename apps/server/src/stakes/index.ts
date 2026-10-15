/**
 * Stakes module: orchestrates MatchEscrow interactions.
 *
 * Flow:
 *  1. createStakeOffer()    — both players agreed; referee calls escrow.open()
 *  2. playerDeposit()       — player approves USDC then calls escrow.deposit()
 *  3. settleMatch()         — after game ends; anyone calls escrow.settle()
 *  4. cancelUnfunded()      — after fund_deadline with < 2 deposits
 *  5. refundAfterTimeout()  — 24 h after both deposits and still unsettled
 *
 * All contract calls go through the BullMQ writer so nonces are serialised.
 * The USDC approve + deposit calls are sent from the PLAYER wallet (Circle
 * developer-controlled) via createContractExecution.
 */

import { sql }  from "../db/client.ts";
import { cfg }  from "../config/index.ts";
import {
  createContractExecution,
  uuidV5,
  pollTx,
} from "../chain/circle.ts";
import { startWorker } from "../chain/writer.ts";
import { nanoid } from "../util/ids.ts";

// ── ABI fragments ─────────────────────────────────────────────────────────────

const APPROVE_SIG  = "approve(address,uint256)";
const DEPOSIT_SIG  = "deposit(bytes32)";
const OPEN_SIG     = "open(bytes32,bytes32,address,address,uint256,uint64)";
const SETTLE_SIG   = "settle(bytes32)";
const CANCEL_SIG   = "cancelUnfunded(bytes32)";
const TIMEOUT_SIG  = "refundAfterTimeout(bytes32)";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StakeOffer {
  id:             string;
  gameId:         string | null;
  matchId:        string | null;
  amountUsdc6:    bigint;
  whiteId:        string;
  blackId:        string;
  whiteApproved:  boolean;
  blackApproved:  boolean;
  status:         "pending" | "open" | "funded" | "settled" | "cancelled" | "refunded" | "timeout";
  fundDeadline:   Date | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBytes32(val: string): string {
  if (val.startsWith("0x")) return val.padEnd(66, "0");
  const hex = Buffer.from(val.slice(0, 32)).toString("hex").padStart(64, "0");
  return "0x" + hex;
}

/** Format a bigint USDC-6 amount as a decimal string for Circle transfer API */
function usdc6ToDecimal(usdc6: bigint): string {
  const whole = usdc6 / 1_000_000n;
  const frac  = usdc6 % 1_000_000n;
  return `${whole}.${frac.toString().padStart(6, "0")}`;
}

// ── Create stake offer ────────────────────────────────────────────────────────

export async function createStakeOffer(
  whiteId: string,
  blackId: string,
  amountUsdc6: bigint,
): Promise<StakeOffer> {
  const id = "so_" + nanoid(8);
  await sql`
    INSERT INTO stake_offers (id, amount_usdc6, white_id, black_id)
    VALUES (${id}, ${amountUsdc6.toString()}, ${whiteId}, ${blackId})
  `;
  return {
    id,
    gameId:       null,
    matchId:      null,
    amountUsdc6,
    whiteId,
    blackId,
    whiteApproved: false,
    blackApproved: false,
    status:       "pending",
    fundDeadline: null,
  };
}

// ── Attach game and open on-chain ─────────────────────────────────────────────

export async function openStakeOnChain(opts: {
  stakeOfferId: string;
  gameId:       string;
  chainGameId:  string;   // bytes32 game id from FinalMoveLedger
  whiteAddr:    string;
  blackAddr:    string;
  amountUsdc6:  bigint;
  fundDeadlineSec: number;  // seconds from now
}): Promise<string> {
  const matchId  = toBytes32(opts.stakeOfferId);
  const deadline = Math.floor(Date.now() / 1000) + opts.fundDeadlineSec;
  const deadlineDate = new Date(deadline * 1000);

  const idempKey = uuidV5(`escrow:open:${opts.stakeOfferId}`);
  const tx = await createContractExecution({
    idempotencyKey:      idempKey,
    walletId:            cfg.REFEREE_WALLET_ID,
    contractAddress:     cfg.ESCROW_ADDRESS,
    abiFunctionSignature: OPEN_SIG,
    abiParameters: [
      matchId,
      toBytes32(opts.chainGameId),
      opts.whiteAddr,
      opts.blackAddr,
      opts.amountUsdc6.toString(),
      deadline,
    ],
    feeLevel: "HIGH",
  });

  const final = await pollTx(tx.id, 60_000);
  if (final.state !== "COMPLETE") {
    throw new Error(`escrow.open tx ${tx.id} ended ${final.state}`);
  }

  await sql`
    UPDATE stake_offers
    SET game_id=${opts.gameId}, match_id=${opts.stakeOfferId},
        status='open', fund_deadline=${deadlineDate.toISOString()}, updated_at=now()
    WHERE id=${opts.stakeOfferId}
  `;
  await sql`
    UPDATE games SET staked=true, stake_offer_id=${opts.stakeOfferId},
                     escrow_match_id=${opts.stakeOfferId}
    WHERE id=${opts.gameId}
  `;

  console.log(`[stakes] opened matchId=${matchId} game=${opts.gameId} amount=${usdc6ToDecimal(opts.amountUsdc6)} USDC`);
  return matchId;
}

// ── Player approve + deposit ──────────────────────────────────────────────────

export async function playerApproveAndDeposit(opts: {
  stakeOfferId: string;
  playerId:     string;
  playerWalletId: string;
  amountUsdc6:  bigint;
}): Promise<void> {
  const matchId = toBytes32(opts.stakeOfferId);
  const depositId = "sd_" + nanoid(8);

  await sql`
    INSERT INTO stake_deposits (id, stake_offer_id, player_id, state)
    VALUES (${depositId}, ${opts.stakeOfferId}, ${opts.playerId}, 'pending')
    ON CONFLICT (stake_offer_id, player_id) DO UPDATE SET state='pending'
  `;

  // Step 1: approve USDC to escrow
  const approveTx = await createContractExecution({
    idempotencyKey:      uuidV5(`approve:${opts.stakeOfferId}:${opts.playerId}`),
    walletId:            opts.playerWalletId,
    contractAddress:     cfg.USDC_ADDRESS,
    abiFunctionSignature: APPROVE_SIG,
    abiParameters:       [cfg.ESCROW_ADDRESS, opts.amountUsdc6.toString()],
    feeLevel:            "HIGH",
  });

  const approveFinal = await pollTx(approveTx.id, 60_000);
  if (approveFinal.state !== "COMPLETE") {
    throw new Error(`USDC approve tx ${approveTx.id} ended ${approveFinal.state}`);
  }

  // Step 2: call escrow.deposit()
  startWorker(opts.playerWalletId);
  const depositTx = await createContractExecution({
    idempotencyKey:      uuidV5(`deposit:${opts.stakeOfferId}:${opts.playerId}`),
    walletId:            opts.playerWalletId,
    contractAddress:     cfg.ESCROW_ADDRESS,
    abiFunctionSignature: DEPOSIT_SIG,
    abiParameters:       [matchId],
    feeLevel:            "HIGH",
  });

  await sql`
    UPDATE stake_deposits
    SET circle_tx_id=${depositTx.id}, state='submitted'
    WHERE id=${depositId}
  `;

  const depositFinal = await pollTx(depositTx.id, 120_000);
  if (depositFinal.state !== "COMPLETE") {
    await sql`UPDATE stake_deposits SET state='failed' WHERE id=${depositId}`;
    throw new Error(`escrow.deposit tx ${depositTx.id} ended ${depositFinal.state}`);
  }

  await sql`
    UPDATE stake_deposits
    SET tx_hash=${depositFinal.txHash ?? null}, state='confirmed'
    WHERE id=${depositId}
  `;

  // Mark player as deposited on stake_offer
  const offer = await getStakeOffer(opts.stakeOfferId);
  if (!offer) throw new Error("stake offer not found");

  if (opts.playerId === offer.whiteId) {
    await sql`UPDATE stake_offers SET white_approved=true, updated_at=now() WHERE id=${opts.stakeOfferId}`;
  } else {
    await sql`UPDATE stake_offers SET black_approved=true, updated_at=now() WHERE id=${opts.stakeOfferId}`;
  }

  // Check if both deposited → mark funded
  const updated = await getStakeOffer(opts.stakeOfferId);
  if (updated?.whiteApproved && updated?.blackApproved) {
    await sql`UPDATE stake_offers SET status='funded', updated_at=now() WHERE id=${opts.stakeOfferId}`;
    console.log(`[stakes] match ${opts.stakeOfferId} fully funded`);
  }

  console.log(`[stakes] player ${opts.playerId} deposited for match ${opts.stakeOfferId} tx=${depositFinal.txHash}`);
}

// ── Settle (called after game ends) ──────────────────────────────────────────

export async function settleMatch(stakeOfferId: string): Promise<void> {
  const matchId = toBytes32(stakeOfferId);
  const idempKey = uuidV5(`settle:${stakeOfferId}`);

  const tx = await createContractExecution({
    idempotencyKey:      idempKey,
    walletId:            cfg.REFEREE_WALLET_ID,
    contractAddress:     cfg.ESCROW_ADDRESS,
    abiFunctionSignature: SETTLE_SIG,
    abiParameters:       [matchId],
    feeLevel:            "HIGH",
  });

  const final = await pollTx(tx.id, 120_000);
  if (final.state !== "COMPLETE") {
    throw new Error(`escrow.settle tx ${tx.id} ended ${final.state}`);
  }

  await sql`UPDATE stake_offers SET status='settled', updated_at=now() WHERE id=${stakeOfferId}`;
  console.log(`[stakes] settled match ${stakeOfferId} tx=${final.txHash}`);
}

// ── Cancel unfunded (after fund_deadline) ────────────────────────────────────

export async function cancelUnfunded(stakeOfferId: string): Promise<void> {
  const matchId  = toBytes32(stakeOfferId);
  const idempKey = uuidV5(`cancelUnfunded:${stakeOfferId}`);

  const tx = await createContractExecution({
    idempotencyKey:      idempKey,
    walletId:            cfg.REFEREE_WALLET_ID,
    contractAddress:     cfg.ESCROW_ADDRESS,
    abiFunctionSignature: CANCEL_SIG,
    abiParameters:       [matchId],
    feeLevel:            "HIGH",
  });

  const final = await pollTx(tx.id, 120_000);
  if (final.state !== "COMPLETE") {
    throw new Error(`escrow.cancelUnfunded tx ${tx.id} ended ${final.state}`);
  }

  await sql`UPDATE stake_offers SET status='cancelled', updated_at=now() WHERE id=${stakeOfferId}`;
  console.log(`[stakes] cancelled match ${stakeOfferId} tx=${final.txHash}`);
}

// ── Refund after timeout (24 h after both deposits) ───────────────────────────

export async function refundAfterTimeout(stakeOfferId: string): Promise<void> {
  const matchId  = toBytes32(stakeOfferId);
  const idempKey = uuidV5(`timeout:${stakeOfferId}`);

  const tx = await createContractExecution({
    idempotencyKey:      idempKey,
    walletId:            cfg.REFEREE_WALLET_ID,
    contractAddress:     cfg.ESCROW_ADDRESS,
    abiFunctionSignature: TIMEOUT_SIG,
    abiParameters:       [matchId],
    feeLevel:            "HIGH",
  });

  const final = await pollTx(tx.id, 120_000);
  if (final.state !== "COMPLETE") {
    throw new Error(`escrow.refundAfterTimeout tx ${tx.id} ended ${final.state}`);
  }

  await sql`UPDATE stake_offers SET status='timeout', updated_at=now() WHERE id=${stakeOfferId}`;
  console.log(`[stakes] timeout-refunded match ${stakeOfferId} tx=${final.txHash}`);
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function getStakeOffer(id: string): Promise<StakeOffer | null> {
  const rows = await sql<{
    id: string; game_id: string | null; match_id: string | null;
    amount_usdc6: string; white_id: string; black_id: string;
    white_approved: boolean; black_approved: boolean;
    status: string; fund_deadline: Date | null;
  }[]>`
    SELECT id, game_id, match_id, amount_usdc6, white_id, black_id,
           white_approved, black_approved, status, fund_deadline
    FROM stake_offers WHERE id=${id}
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    id:            r.id,
    gameId:        r.game_id,
    matchId:       r.match_id,
    amountUsdc6:   BigInt(r.amount_usdc6),
    whiteId:       r.white_id,
    blackId:       r.black_id,
    whiteApproved: r.white_approved,
    blackApproved: r.black_approved,
    status:        r.status as StakeOffer["status"],
    fundDeadline:  r.fund_deadline,
  };
}

/** Hook called by the referee when a staked game ends — auto-settles. */
export async function onStakedGameEnd(stakeOfferId: string): Promise<void> {
  const offer = await getStakeOffer(stakeOfferId);
  if (!offer) return;
  if (offer.status !== "funded") return;  // must have both deposits
  try {
    await settleMatch(stakeOfferId);
  } catch (e) {
    console.error(`[stakes] auto-settle failed for ${stakeOfferId}:`, (e as Error).message);
  }
}
