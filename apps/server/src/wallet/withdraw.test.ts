/**
 * Integration tests for initiateWithdrawal and the reconciler.
 *
 * Runs against the real Postgres from docker-compose (DATABASE_URL env var).
 * Mocks:
 *   - _balanceReader.fn  (exported mutable ref on withdraw.ts) — onchain balanceOf
 *   - ../chain/circle.ts  — all Circle API calls via mock.module()
 *
 * No real mainnet transfers are made.
 *
 * Run with:
 *   bun test apps/server/src/wallet/withdraw.test.ts
 */

import { describe, it, expect, beforeAll, afterEach, mock } from "bun:test";

// These tests write rows to whatever DATABASE_URL points at. Refuse to run
// unless the caller says this is a throwaway test database.
if (process.env.WITHDRAW_TEST_DB !== "1" || process.env.NETWORK === "mainnet") {
  throw new Error("Refusing to run: set WITHDRAW_TEST_DB=1 and point DATABASE_URL at a throwaway test database (never mainnet).");
}

// ── Circle mock — must be set up before importing withdraw.ts ─────────────────
// Bun's mock.module() replaces the module in the ESM registry. The mock state
// object is mutated per-test so each test controls what Circle returns.

interface CircleTx { id: string; state: string; txHash?: string }
interface TransferOpts { idempotencyKey: string; sourceWalletId: string; destinationAddress: string; tokenAddress: string; amount: string; feeLevel?: string; }

const circleMock = {
  transfer: async (_opts: TransferOpts): Promise<CircleTx> => {
    throw new Error("circleMock.transfer not configured for this test");
  },
  getStatus: async (_id: string): Promise<CircleTx> => {
    throw new Error("circleMock.getStatus not configured for this test");
  },
};

// Import the real uuidV5 before mocking so the mock can re-export it.
// This means the reconciler uses the same deterministic key as the test assertion.
import { uuidV5 as realUuidV5 } from "../chain/circle.ts";

mock.module("../chain/circle.ts", () => ({
  createTokenTransfer: (opts: TransferOpts) => circleMock.transfer(opts),
  getTxStatus:         (id: string)         => circleMock.getStatus(id),
  uuidV5:              realUuidV5,
  getUsdcBalance:          async () => 0n,
  getWalletBalances:       async () => [],
  createContractExecution: async () => { throw new Error("not mocked"); },
  pollTx:                  async () => { throw new Error("not mocked"); },
  createWallet:            async () => [],
}));

// ── Now import the modules under test ─────────────────────────────────────────
import { sql } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import {
  initiateWithdrawal,
  trackWithdrawal,
  _balanceReader,
  _reconcilePendingWithdrawals,
  type WithdrawInput,
} from "./withdraw.ts";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TEST_USER_ID   = "u_test_wd_001";
const TEST_USER_ID2  = "u_test_wd_002";
const TEST_WALLET_CW = "cw_test_wd_001";
const TEST_ADDRESS   = "0x1111111111111111111111111111111111111111";
const TEST_DEST      = "0x2222222222222222222222222222222222222222";

// 0.25 USDC reserve (matches TOPUP_AMOUNT_USDC default)
const RESERVE_USDC6  = 250_000n;
const ONE_USDC6      = 1_000_000n;

function uuid(): string { return crypto.randomUUID(); }

function baseInput(overrides: Partial<WithdrawInput> = {}): WithdrawInput {
  return {
    callerId:       TEST_USER_ID,
    callerType:     "user",
    destination:    TEST_DEST,
    amountUsdc:     0.50,
    idempotencyKey: uuid(),
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await runMigrations();
  await sql`
    INSERT INTO users (id, handle) VALUES
      (${TEST_USER_ID},  'tw_user_1'),
      (${TEST_USER_ID2}, 'tw_user_2')
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO wallets (id, owner_type, owner_id, circle_wallet_id, address, chain)
    VALUES ('wrow_tw_001', 'user', ${TEST_USER_ID}, ${TEST_WALLET_CW}, ${TEST_ADDRESS}, 'ARC')
    ON CONFLICT DO NOTHING
  `;
});

afterEach(async () => {
  await sql`DELETE FROM withdrawals WHERE user_id IN (${TEST_USER_ID}, ${TEST_USER_ID2})`;
  // Reset balance mock to a safe default after each test
  _balanceReader.fn = async () => ONE_USDC6 + RESERVE_USDC6;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function setBalance(usdc6: bigint) {
  _balanceReader.fn = async (_addr: string) => usdc6;
}

function setTransfer(result: CircleTx | Error | ((opts: TransferOpts) => Promise<CircleTx>)) {
  if (result instanceof Error) {
    circleMock.transfer = async () => { throw result; };
  } else if (typeof result === "function") {
    circleMock.transfer = result;
  } else {
    circleMock.transfer = async () => result;
  }
}

function setStatus(state: string, txHash?: string) {
  circleMock.getStatus = async (id) => ({ id, state, txHash });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("initiateWithdrawal", () => {

  it("rejects a guest", async () => {
    try {
      await initiateWithdrawal(baseInput({ callerType: "guest" }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("signed-in players");
      expect((e as { status?: number }).status).toBe(403);
    }
  });

  it("rejects an agent", async () => {
    try {
      await initiateWithdrawal(baseInput({ callerType: "agent" }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("signed-in players");
    }
  });

  it("rejects a non-UUID idempotency key", async () => {
    try {
      await initiateWithdrawal(baseInput({ idempotencyKey: "not-a-uuid" }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("Invalid idempotency key");
    }
  });

  it("enforces the gas reserve (balance below reserve)", async () => {
    setBalance(100_000n); // 0.10 USDC — below the 0.25 reserve
    try {
      await initiateWithdrawal(baseInput({ amountUsdc: 0.10 }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("0.000000 USDC");
    }
  });

  it("enforces the gas reserve (amount over withdrawable)", async () => {
    setBalance(750_000n); // 0.75 USDC → withdrawable = 0.50
    try {
      await initiateWithdrawal(baseInput({ amountUsdc: 0.60 }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("0.500000 USDC");
    }
  });

  it("enforces the 24-hour rolling cap", async () => {
    setBalance(BigInt(200_000_000) + RESERVE_USDC6); // plenty of balance
    // Pre-fill the cap with a completed withdrawal
    const { WITHDRAW_DAILY_CAP_USDC6 } = await import("../config/index.ts");
    await sql`
      INSERT INTO withdrawals
        (id, user_id, circle_wallet_id, destination, amount_usdc6, idempotency_key, state, created_at)
      VALUES
        ('wd_captest_01', ${TEST_USER_ID}, ${TEST_WALLET_CW}, ${TEST_DEST},
         ${WITHDRAW_DAILY_CAP_USDC6.toString()}, ${uuid()}, 'complete', now() - interval '1 hour')
    `;
    try {
      await initiateWithdrawal(baseInput({ amountUsdc: 0.10 }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("Daily withdrawal limit reached");
    }
  });

  it("returns original row on repeated idempotency key (no second transfer)", async () => {
    setBalance(ONE_USDC6 + RESERVE_USDC6);
    let transferCount = 0;
    setTransfer(async () => { transferCount++; return { id: `cirtx_idem_${transferCount}`, state: "INITIATED" }; });

    const key = uuid();
    const first = await initiateWithdrawal(baseInput({ amountUsdc: 0.10, idempotencyKey: key }));
    expect(first.alreadyExisted).toBe(false);
    const countAfterFirst = transferCount;

    const second = await initiateWithdrawal(baseInput({ amountUsdc: 0.10, idempotencyKey: key }));
    expect(second.alreadyExisted).toBe(true);
    expect(second.withdrawal.id).toBe(first.withdrawal.id);
    // No additional Circle call was made
    expect(transferCount).toBe(countAfterFirst);
  });

  it("prevents user_2 from touching user_1's wallet (user_2 has no wallet → 404)", async () => {
    try {
      await initiateWithdrawal(baseInput({ callerId: TEST_USER_ID2 }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { status?: number }).status).toBe(404);
      expect((e as Error).message).toContain("Wallet not found");
    }
  });

  it("leaves row pending on ambiguous Circle error (ECONNRESET)", async () => {
    setBalance(ONE_USDC6 + RESERVE_USDC6);
    setTransfer(new Error("ECONNRESET: connection reset by peer"));

    let thrown: Error & { status?: number } | null = null;
    try {
      await initiateWithdrawal(baseInput({ amountUsdc: 0.10 }));
    } catch (e) { thrown = e as Error & { status?: number }; }

    expect(thrown).not.toBeNull();
    expect(thrown!.status).toBe(502);
    expect(thrown!.message).toContain("status is unknown");

    // Row must be pending, not failed
    const rows = await sql<{ state: string }[]>`
      SELECT state FROM withdrawals WHERE user_id = ${TEST_USER_ID}
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(rows[0]?.state).toBe("pending");
  });

  it("treats a Circle 409 idempotency conflict as uncertain, not failed", async () => {
    setBalance(ONE_USDC6 + RESERVE_USDC6);
    setTransfer(new Error('Circle transfer 409: {"code":175403,"message":"Please use a new idempotency key."}'));

    let thrown: Error & { status?: number } | null = null;
    try {
      await initiateWithdrawal(baseInput({ amountUsdc: 0.10 }));
    } catch (e) { thrown = e as Error & { status?: number }; }

    expect(thrown!.status).toBe(502);
    const rows = await sql<{ state: string }[]>`
      SELECT state FROM withdrawals WHERE user_id = ${TEST_USER_ID}
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(rows[0]?.state).toBe("pending");
  });

  it("marks a definite Circle 400 rejection as failed", async () => {
    setBalance(ONE_USDC6 + RESERVE_USDC6);
    setTransfer(new Error('Circle transfer 400: {"code":175410,"message":"invalid address format"}'));

    let thrown: Error & { status?: number } | null = null;
    try {
      await initiateWithdrawal(baseInput({ amountUsdc: 0.10 }));
    } catch (e) { thrown = e as Error & { status?: number }; }

    expect(thrown!.status).toBe(400);
    const rows = await sql<{ state: string }[]>`
      SELECT state FROM withdrawals WHERE user_id = ${TEST_USER_ID}
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(rows[0]?.state).toBe("failed");
  });

  it("sends 1.13 USDC as exactly 1130000 units", async () => {
    setBalance(ONE_USDC6 * 2n + RESERVE_USDC6);
    let sentAmount = "";
    setTransfer(async (opts) => { sentAmount = opts.amount; return { id: "cirtx_round", state: "INITIATED" }; });
    await initiateWithdrawal(baseInput({ amountUsdc: 1.13 }));
    expect(sentAmount).toBe("1.130000");
  });

  it("two concurrent calls with different keys: only one succeeds, only one transfer sent", async () => {
    setBalance(ONE_USDC6 + RESERVE_USDC6);
    let transferCount = 0;
    setTransfer(async () => {
      await new Promise(r => setTimeout(r, 10));
      transferCount++;
      return { id: `cirtx_conc_${transferCount}`, state: "INITIATED" };
    });

    const results = await Promise.allSettled([
      initiateWithdrawal(baseInput({ amountUsdc: 0.10, idempotencyKey: uuid() })),
      initiateWithdrawal(baseInput({ amountUsdc: 0.10, idempotencyKey: uuid() })),
    ]);

    const succeeded = results.filter(r => r.status === "fulfilled");
    const rejected  = results.filter(r => r.status === "rejected");
    expect(succeeded.length).toBe(1);
    expect(rejected.length).toBe(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as { status?: number };
    expect(reason.status).toBe(409);
    expect(transferCount).toBe(1);
  });
});

describe("reconciler helpers", () => {

  it("reconciler resubmits pending row with same stable Circle key", async () => {
    const wdId = `wd_rec_${shortId()}`;
    await sql`
      INSERT INTO withdrawals
        (id, user_id, circle_wallet_id, destination, amount_usdc6, idempotency_key, state, created_at, updated_at)
      VALUES
        (${wdId}, ${TEST_USER_ID}, ${TEST_WALLET_CW}, ${TEST_DEST},
         '100000', ${uuid()}, 'pending',
         now() - interval '5 minutes', now() - interval '5 minutes')
    `;

    let capturedKey: string | null = null;
    setTransfer(async (opts) => { capturedKey = opts.idempotencyKey; return { id: "cirtx_rec_01", state: "INITIATED" }; });
    setStatus("INITIATED");

    // age=0 processes all pending regardless of age
    await _reconcilePendingWithdrawals(0);

    const rows = await sql<{ state: string; circle_tx_id: string | null }[]>`
      SELECT state, circle_tx_id FROM withdrawals WHERE id = ${wdId}
    `;
    expect(rows[0]?.state).toBe("sent");
    expect(rows[0]?.circle_tx_id).toBe("cirtx_rec_01");
    // The key must be deterministic: the same call next time produces the same key
    expect(capturedKey).toBe(realUuidV5(`withdraw:${wdId}`));
  });

  it("reconciler moves sent row to complete when Circle reports COMPLETE", async () => {
    const wdId = `wd_rec_${shortId()}`;
    await sql`
      INSERT INTO withdrawals
        (id, user_id, circle_wallet_id, destination, amount_usdc6, idempotency_key, state, circle_tx_id, created_at, updated_at)
      VALUES
        (${wdId}, ${TEST_USER_ID}, ${TEST_WALLET_CW}, ${TEST_DEST},
         '100000', ${uuid()}, 'sent', 'cirtx_sent_001',
         now() - interval '5 minutes', now() - interval '5 minutes')
    `;

    setStatus("COMPLETE", "0xdeadbeef00000000000000000000000000000000000000000000000000000000");

    await trackWithdrawal(wdId, "cirtx_sent_001");

    const rows = await sql<{ state: string; tx_hash: string | null }[]>`
      SELECT state, tx_hash FROM withdrawals WHERE id = ${wdId}
    `;
    expect(rows[0]?.state).toBe("complete");
    expect(rows[0]?.tx_hash).toBe("0xdeadbeef00000000000000000000000000000000000000000000000000000000");
  });
});

// ── Local short-id for test rows ──────────────────────────────────────────────
function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}
