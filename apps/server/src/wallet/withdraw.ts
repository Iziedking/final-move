/**
 * Player USDC withdrawal logic — fixed for mainnet safety.
 *
 * Key properties:
 *  1. Idempotency check (scoped to user) runs FIRST, inside the advisory-locked
 *     DB transaction, before any balance or cap check. A retry after a lost
 *     response always returns the original row without re-checking the balance.
 *  2. Balance is read on-chain (viem balanceOf) inside the DB transaction after
 *     the advisory lock, preventing a race between two concurrent requests.
 *  3. Circle errors are classified: 4xx before a tx id = definite rejection
 *     (mark failed); timeout / network / 5xx = ambiguous (leave pending, log).
 *     Only definite failures free up the in-flight slot and the cap.
 *  4. trackWithdrawal leaves rows pending on ambiguous errors; the reconciler
 *     (startWithdrawalReconciler, runs every 60 s) picks them back up.
 *  5. Internal error details are never returned to callers; a short code goes in
 *     the response, the full detail goes to the server log and the DB error col.
 *  6. idempotencyKey must be a UUID v4.
 */

import { createPublicClient, http, isAddress, type PublicClient } from "viem";
import { sql } from "../db/client.ts";
import {
  cfg,
  WITHDRAW_MIN_USDC6,
  WITHDRAW_DAILY_CAP_USDC6,
  WITHDRAW_GAS_RESERVE_USDC6,
} from "../config/index.ts";
import {
  createTokenTransfer,
  getTxStatus,
  uuidV5,
} from "../chain/circle.ts";
import { nanoid } from "../util/ids.ts";

// ── On-chain USDC balance via viem ────────────────────────────────────────────

const BALANCE_OF_ABI = [{
  name: "balanceOf",
  type: "function",
  stateMutability: "view",
  inputs:  [{ name: "account", type: "address" }],
  outputs: [{ name: "",        type: "uint256" }],
}] as const;

let _publicClient: PublicClient | null = null;
function getPublicClient(): PublicClient {
  if (!_publicClient) {
    _publicClient = createPublicClient({ transport: http(cfg.ARC_RPC_URL) });
  }
  return _publicClient;
}

// Injectable for tests — mutate _balanceReader.fn to override.
export const _balanceReader = {
  fn: async (address: string): Promise<bigint> => {
    const client = getPublicClient();
    const result = await client.readContract({
      address: cfg.USDC_ADDRESS as `0x${string}`,
      abi: BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    });
    return result as bigint;
  },
};

// Keep the export for backwards compat but route through the injectable.
export const readOnchainUsdc = (address: string): Promise<bigint> =>
  _balanceReader.fn(address);

// ── UUID v4 regex ─────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WithdrawalRow {
  id:               string;
  user_id:          string;
  circle_wallet_id: string;
  destination:      string;
  amount_usdc6:     bigint;
  idempotency_key:  string;
  circle_tx_id:     string | null;
  tx_hash:          string | null;
  state:            "pending" | "sent" | "complete" | "failed";
  error:            string | null;
  created_at:       Date;
  updated_at:       Date;
}

export interface WithdrawInput {
  callerId:       string;
  callerType:     "user" | "guest" | "agent";
  destination:    string;
  amountUsdc:     number;       // decimal, e.g. 1.50
  idempotencyKey: string;
}

export interface WithdrawResult {
  withdrawal:     WithdrawalRow;
  alreadyExisted: boolean;
}

// ── User-facing error ─────────────────────────────────────────────────────────
// Thrown on validation failures. `status` is the HTTP status to use.
// `code` is a short machine-readable key stored in the DB error column.
// `internal` is the full detail written to the log (never sent to the client).
class WithdrawError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly status: 400 | 403 | 404 | 409,
    public readonly code: string,
  ) {
    super(userMessage);
    this.name = "WithdrawError";
  }
}

/** Initiate a player withdrawal.
 *  Throws WithdrawError (validation) or attaches status=502 (transfer error).
 */
export async function initiateWithdrawal(input: WithdrawInput): Promise<WithdrawResult> {
  const { callerId, callerType, destination, amountUsdc, idempotencyKey } = input;

  // ── 1. Caller must be a signed-in user ──────────────────────────────────────
  if (callerType !== "user") {
    throw new WithdrawError(
      "Withdrawals are available to signed-in players only.",
      403, "not_user",
    );
  }

  // ── 2. idempotencyKey must be a UUID v4 ─────────────────────────────────────
  if (!UUID_RE.test(idempotencyKey)) {
    throw new WithdrawError("Invalid idempotency key.", 400, "bad_idempotency_key");
  }

  // ── 3. Amount must be a positive finite number ───────────────────────────────
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    throw new WithdrawError("Amount must be a positive number.", 400, "bad_amount");
  }
  // Round, not floor: 1.13 * 1e6 is 1129999.9999999998 in floating point, and
  // flooring would send 1.129999. Anything over the balance is rejected below.
  const amountUsdc6 = BigInt(Math.round(amountUsdc * 1_000_000));

  // ── 4. Minimum ───────────────────────────────────────────────────────────────
  if (amountUsdc6 < WITHDRAW_MIN_USDC6) {
    const minDisplay = (Number(WITHDRAW_MIN_USDC6) / 1_000_000).toFixed(2);
    throw new WithdrawError(
      `Minimum withdrawal is ${minDisplay} USDC.`,
      400, "below_minimum",
    );
  }

  // ── 5. Validate destination address ─────────────────────────────────────────
  if (!isAddress(destination)) {
    throw new WithdrawError("Destination is not a valid address.", 400, "bad_destination");
  }
  const dest = destination.toLowerCase();
  if (dest === "0x0000000000000000000000000000000000000000") {
    throw new WithdrawError("Destination cannot be the zero address.", 400, "zero_address");
  }
  if (dest === cfg.USDC_ADDRESS.toLowerCase()) {
    throw new WithdrawError("Destination cannot be the USDC contract address.", 400, "usdc_contract");
  }

  // ── 6. Look up the caller's wallet (server-side; never from client) ──────────
  const walletRows = await sql<{ circle_wallet_id: string; address: string }[]>`
    SELECT circle_wallet_id, address
    FROM   wallets
    WHERE  owner_type = 'user'
      AND  owner_id   = ${callerId}
    LIMIT  1
  `;
  const wallet = walletRows[0];
  if (!wallet) {
    throw new WithdrawError("Wallet not found. Try again in a moment.", 404, "no_wallet");
  }
  if (wallet.address.toLowerCase() === dest) {
    throw new WithdrawError("Destination cannot be your own wallet address.", 400, "self_send");
  }

  // ── 7. DB transaction: advisory lock → idempotency (FIRST) → balance →
  //       cap → in-flight → insert ────────────────────────────────────────────
  let row!: WithdrawalRow;
  let alreadyExisted = false;

  await (sql.begin(async (tx) => {
    // Advisory lock on this user — serialises all concurrent withdraw calls.
    // hashtext() is deterministic within a Postgres session.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${callerId}))`;

    // IDEMPOTENCY FIRST — before balance or cap check.
    // If the client retried after a lost response, the balance may be lower now
    // because the first transfer already went through. Returning the original
    // row here avoids a false "insufficient balance" error on legitimate retries.
    // Scoped to (user_id, idempotency_key) so keys from different users never clash.
    const existing = await tx<WithdrawalRow[]>`
      SELECT * FROM withdrawals
      WHERE  user_id         = ${callerId}
        AND  idempotency_key = ${idempotencyKey}
      LIMIT  1
    `;
    if (existing[0]) {
      row = existing[0];
      alreadyExisted = true;
      return;
    }

    // Balance read on-chain (viem balanceOf) inside the advisory lock.
    // Circle's balance API can lag the chain; reading on-chain is authoritative
    // and prevents two concurrent requests both passing the balance check before
    // either has debited the wallet.
    const liveBalance = await _balanceReader.fn(wallet.address);
    const withdrawable = liveBalance > WITHDRAW_GAS_RESERVE_USDC6
      ? liveBalance - WITHDRAW_GAS_RESERVE_USDC6
      : 0n;

    if (amountUsdc6 > withdrawable) {
      const wDisplay  = (Number(withdrawable) / 1_000_000).toFixed(6);
      const resDisplay = (Number(WITHDRAW_GAS_RESERVE_USDC6) / 1_000_000).toFixed(2);
      throw new WithdrawError(
        `You can withdraw up to ${wDisplay} USDC. We keep ${resDisplay} USDC in your wallet to cover gas.`,
        400, "insufficient_balance",
      );
    }

    // Only one in-flight withdrawal per user at a time.
    const inFlight = await tx<{ id: string }[]>`
      SELECT id FROM withdrawals
      WHERE  user_id = ${callerId}
        AND  state IN ('pending', 'sent')
      LIMIT  1
    `;
    if (inFlight[0]) {
      throw new WithdrawError(
        "You already have a withdrawal in progress. Wait for it to complete before sending another.",
        409, "in_flight",
      );
    }

    // Rolling 24-hour cap (only confirmed + in-flight rows count; failed do not).
    const capRows = await tx<{ total: string }[]>`
      SELECT COALESCE(SUM(amount_usdc6), 0)::text AS total
      FROM   withdrawals
      WHERE  user_id    = ${callerId}
        AND  state     <> 'failed'
        AND  created_at > now() - interval '24 hours'
    `;
    const capUsed = BigInt(capRows[0]?.total ?? "0");
    if (capUsed + amountUsdc6 > WITHDRAW_DAILY_CAP_USDC6) {
      const remaining = WITHDRAW_DAILY_CAP_USDC6 > capUsed
        ? WITHDRAW_DAILY_CAP_USDC6 - capUsed : 0n;
      const remDisplay = (Number(remaining) / 1_000_000).toFixed(2);
      throw new WithdrawError(
        `Daily withdrawal limit reached. You can withdraw up to ${remDisplay} USDC more today.`,
        400, "daily_cap",
      );
    }

    const id = `wd_${nanoid(10)}`;
    const inserted = await tx<WithdrawalRow[]>`
      INSERT INTO withdrawals
        (id, user_id, circle_wallet_id, destination, amount_usdc6, idempotency_key, state)
      VALUES
        (${id}, ${callerId}, ${wallet.circle_wallet_id}, ${destination},
         ${amountUsdc6.toString()}, ${idempotencyKey}, 'pending')
      RETURNING *
    `;
    row = inserted[0]!;
  }) as Promise<void>);

  // ── 8. Return immediately for idempotent repeats ─────────────────────────────
  if (alreadyExisted) {
    return { withdrawal: row, alreadyExisted: true };
  }

  // ── 9. Send (outside the DB tx) ─────────────────────────────────────────────
  // Derive a stable Circle idempotency key from the row id.
  // Circle guarantees that a repeated idempotency key returns the original
  // transaction instead of creating a new one (Circle docs: "Idempotent Requests"
  // — if the same idempotencyKey is submitted, the same transaction record is
  // returned regardless of the current state).  This means re-submitting during
  // reconciliation is safe: Circle will never send the USDC a second time.
  const circleKey = uuidV5(`withdraw:${row.id}`);

  try {
    const amountDecimal = (Number(amountUsdc6) / 1_000_000).toFixed(6);
    const circleTx = await createTokenTransfer({
      idempotencyKey:     circleKey,
      sourceWalletId:     wallet.circle_wallet_id,
      destinationAddress: destination,
      tokenAddress:       cfg.USDC_ADDRESS,
      amount:             amountDecimal,
      feeLevel:           "MEDIUM",
    });

    const updated = await sql<WithdrawalRow[]>`
      UPDATE withdrawals
      SET    circle_tx_id = ${circleTx.id},
             state        = 'sent',
             updated_at   = now()
      WHERE  id = ${row.id}
      RETURNING *
    `;
    row = updated[0]!;

    // Track in the background; reconciler handles cases where this process restarts.
    void trackWithdrawal(row.id, circleTx.id).catch((e: unknown) => {
      console.error("[withdraw] background track error", row.id, e);
    });
  } catch (err) {
    const isDefiniteRejection = classifyCircleError(err);
    const detail = err instanceof Error ? err.message : String(err);

    if (isDefiniteRejection) {
      // 4xx before any tx was created — safe to mark failed (money never moved).
      const code = "circle_rejected";
      console.warn("[withdraw] definite rejection", row.id, detail);
      await sql`
        UPDATE withdrawals
        SET    state = 'failed', error = ${code}, updated_at = now()
        WHERE  id = ${row.id}
      `;
      throw Object.assign(
        new Error("Your withdrawal was declined. No funds were moved."),
        { status: 400 as const, code },
      );
    } else {
      // Ambiguous (timeout, network error, 5xx) — leave pending so the reconciler
      // can resubmit with the same Circle key. The money may or may not have moved.
      const code = "circle_uncertain";
      console.error("[withdraw] ambiguous Circle error — leaving pending", row.id, detail);
      await sql`
        UPDATE withdrawals
        SET    error = ${code}, updated_at = now()
        WHERE  id = ${row.id}
      `;
      throw Object.assign(
        new Error("The transfer status is unknown. We will check and update your withdrawal shortly."),
        { status: 502 as const, code },
      );
    }
  }

  return { withdrawal: row, alreadyExisted: false };
}

/**
 * Classify a Circle API error.
 * Returns true only when Circle definitely rejected the request with a 4xx
 * before creating a transaction (funds never moved).
 * Returns false for anything ambiguous: timeouts, network errors, 5xx.
 */
function classifyCircleError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  // createTokenTransfer throws `Circle transfer <status>: <body>`
  const statusMatch = msg.match(/Circle transfer (\d{3})/);
  if (!statusMatch) return false; // not a known HTTP error — ambiguous
  const status = parseInt(statusMatch[1]!, 10);
  // 409 is Circle's idempotency conflict ("Please use a new idempotency key",
  // code 175403). The original request may have created a transfer, so treat it
  // as ambiguous and never as proof that no money moved.
  if (status === 409) return false;
  // Other 4xx = definite rejection (bad request, not enough balance, etc.)
  // 5xx or non-HTTP = ambiguous
  return status >= 400 && status < 500;
}

// ── Background tracker ────────────────────────────────────────────────────────

/** Poll a specific Circle tx to completion.
 *  Only marks failed on a definite FAILED/DENIED/CANCELLED state.
 *  Leaves the row pending on ambiguous errors — the reconciler will retry.
 */
export async function trackWithdrawal(withdrawalId: string, circleTxId: string): Promise<void> {
  const deadline    = Date.now() + 120_000; // 2 minutes
  const intervalMs  = 3_000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const tx = await getTxStatus(circleTxId);
      if (tx.state === "COMPLETE") {
        await sql`
          UPDATE withdrawals
          SET    state = 'complete', tx_hash = ${tx.txHash ?? null}, updated_at = now()
          WHERE  id = ${withdrawalId}
        `;
        return;
      }
      if (["FAILED", "DENIED", "CANCELLED"].includes(tx.state)) {
        // Circle confirmed the tx failed — definitively mark failed.
        console.warn("[withdraw] track: definite failure", withdrawalId, tx.state);
        await sql`
          UPDATE withdrawals
          SET    state = 'failed', error = ${tx.state.toLowerCase()}, updated_at = now()
          WHERE  id    = ${withdrawalId}
        `;
        return;
      }
      // PENDING, INITIATED, QUEUED etc. — keep polling
    } catch (e) {
      // Transient error polling Circle — keep trying until deadline.
      console.warn("[withdraw] track: poll error (will retry)", withdrawalId, (e as Error).message);
    }
  }
  // Deadline exceeded — leave as 'sent'; reconciler picks it up on next cycle.
  console.warn("[withdraw] track: timed out, leaving sent for reconciler", withdrawalId);
}

// ── Reconciler ────────────────────────────────────────────────────────────────

/**
 * Runs every 60 seconds at boot.
 *
 * Two cases handled:
 *  A) State = 'sent' with a circle_tx_id:
 *     Check getTxStatus. Move to complete or failed.
 *
 *  B) State = 'pending' older than 2 minutes (process restart mid-withdrawal,
 *     or send timed out before Circle accepted):
 *     Re-submit with the SAME Circle idempotency key (uuidV5("withdraw:" + id)).
 *     Circle returns the original transaction if one was already created, so
 *     this is safe to call multiple times — it cannot double-send.
 */
export function startWithdrawalReconciler(): void {
  const INTERVAL_MS   = 60_000;
  const PENDING_AGE_MS = 120_000;

  const run = async () => {
    try {
      await reconcileSentWithdrawals();
      await reconcilePendingWithdrawals(PENDING_AGE_MS);
    } catch (e) {
      console.error("[withdraw] reconciler error", (e as Error).message);
    }
  };

  // First run after 10 s to let the server fully boot, then every 60 s.
  setTimeout(() => {
    void run();
    setInterval(() => { void run(); }, INTERVAL_MS);
  }, 10_000);

  console.log("[withdraw] reconciler started (60 s interval)");
}

/** Exported for integration tests only — not part of the public API. */
export async function _reconcileSentWithdrawals(): Promise<void> { return reconcileSentWithdrawals(); }
export async function _reconcilePendingWithdrawals(ageMs: number): Promise<void> { return reconcilePendingWithdrawals(ageMs); }

async function reconcileSentWithdrawals(): Promise<void> {
  const rows = await sql<{ id: string; circle_tx_id: string }[]>`
    SELECT id, circle_tx_id
    FROM   withdrawals
    WHERE  state = 'sent'
      AND  circle_tx_id IS NOT NULL
  `;
  for (const row of rows) {
    try {
      const tx = await getTxStatus(row.circle_tx_id);
      if (tx.state === "COMPLETE") {
        await sql`
          UPDATE withdrawals
          SET    state = 'complete', tx_hash = ${tx.txHash ?? null}, updated_at = now()
          WHERE  id = ${row.id}
        `;
        console.log("[withdraw] reconciler: completed", row.id);
      } else if (["FAILED", "DENIED", "CANCELLED"].includes(tx.state)) {
        await sql`
          UPDATE withdrawals
          SET    state = 'failed', error = ${tx.state.toLowerCase()}, updated_at = now()
          WHERE  id = ${row.id}
        `;
        console.warn("[withdraw] reconciler: failed", row.id, tx.state);
      }
      // Otherwise still in-flight; check again next cycle.
    } catch (e) {
      console.warn("[withdraw] reconciler: poll error for", row.id, (e as Error).message);
    }
  }
}

async function reconcilePendingWithdrawals(ageMs: number): Promise<void> {
  const ageSeconds = Math.floor(ageMs / 1000);
  // Look up the wallet so we can call createTokenTransfer.
  const rows = await sql<{
    id: string; user_id: string; circle_wallet_id: string;
    destination: string; amount_usdc6: string;
  }[]>`
    SELECT id, user_id, circle_wallet_id, destination, amount_usdc6::text
    FROM   withdrawals
    WHERE  state      = 'pending'
      AND  created_at < now() - (${ageSeconds.toString()} || ' seconds')::interval
  `;

  for (const row of rows) {
    const circleKey  = uuidV5(`withdraw:${row.id}`);
    const amountUsdc6 = BigInt(row.amount_usdc6);
    const amountDecimal = (Number(amountUsdc6) / 1_000_000).toFixed(6);
    try {
      const circleTx = await createTokenTransfer({
        idempotencyKey:     circleKey,
        sourceWalletId:     row.circle_wallet_id,
        destinationAddress: row.destination,
        tokenAddress:       cfg.USDC_ADDRESS,
        amount:             amountDecimal,
        feeLevel:           "MEDIUM",
      });
      await sql`
        UPDATE withdrawals
        SET    circle_tx_id = ${circleTx.id},
               state        = 'sent',
               error        = NULL,
               updated_at   = now()
        WHERE  id = ${row.id}
      `;
      console.log("[withdraw] reconciler: resubmitted pending →", row.id, circleTx.id);
      void trackWithdrawal(row.id, circleTx.id).catch((e: unknown) => {
        console.error("[withdraw] reconciler track error", row.id, e);
      });
    } catch (err) {
      const isDefinite = classifyCircleError(err);
      const detail     = err instanceof Error ? err.message : String(err);
      console.error("[withdraw] reconciler: resubmit error", row.id, isDefinite ? "definite" : "ambiguous", detail);
      if (isDefinite) {
        await sql`
          UPDATE withdrawals
          SET    state = 'failed', error = 'circle_rejected', updated_at = now()
          WHERE  id = ${row.id}
        `;
      }
      // Ambiguous: leave pending; try again next cycle.
    }
  }
}
