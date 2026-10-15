/**
 * Stage 6 smoke test — stakes API surface + DB state machine.
 *
 * Tests:
 *  1. Create stake offer
 *  2. Get stake offer
 *  3. Deposit attempt without wallet → graceful 404
 *  4. Open on-chain without funded wallet → graceful error
 *  5. 404 on unknown stake offer
 *  6. Wallet page without wallet → 404
 *  7. Wallet page for bot_3 (has a real wallet)
 *  8. Settle/cancel/timeout on nonexistent → 404
 *
 * Full on-chain escrow integration (win pays 2x, draw refunds, timeout refund)
 * is covered in the integration test suite which uses funded wallets.
 */

// arc-studio-allow-onchain-literal — dummy addresses for smoke test fixtures only
const DUMMY_WHITE = "0x0000000000000000000000000000000000000001";
const DUMMY_BLACK = "0x0000000000000000000000000000000000000002";
const DUMMY_GAME  = "0x" + "00".repeat(32);

const BASE = "http://localhost:3001";
let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`, detail);
    failed++;
  }
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

// ── 0. Seed test users ────────────────────────────────────────────────────────
await post("/v1/users/upsert", { id: "u_stake_white", handle: "StakeWhite" });
await post("/v1/users/upsert", { id: "u_stake_black", handle: "StakeBlack" });

// ── 1. Create stake offer ─────────────────────────────────────────────────────
console.log("\n[1] Stake offer create");

const offerRes = await post("/v1/stakes", {
  whiteId:     "u_stake_white",
  blackId:     "u_stake_black",
  amountUsdc6: 2_000_000,
}) as { stakeOfferId?: string; status?: string; error?: string };

ok("POST /v1/stakes → stakeOfferId", !!offerRes.stakeOfferId, offerRes);
ok("POST /v1/stakes → status=pending", offerRes.status === "pending", offerRes.status);

const stakeOfferId = offerRes.stakeOfferId!;

// ── 2. Get stake offer ────────────────────────────────────────────────────────
console.log("\n[2] Get stake offer");

const fetched = await get(`/v1/stakes/${stakeOfferId}`) as {
  id?: string; whiteId?: string; blackId?: string;
  amountUsdc6?: string; status?: string;
};

ok("GET /v1/stakes/:id → id",          fetched.id === stakeOfferId, fetched.id);
ok("GET /v1/stakes/:id → amountUsdc6", fetched.amountUsdc6 === "2000000", fetched.amountUsdc6);
ok("GET /v1/stakes/:id → whiteId",     fetched.whiteId === "u_stake_white", fetched.whiteId);
ok("GET /v1/stakes/:id → blackId",     fetched.blackId === "u_stake_black", fetched.blackId);

// ── 3. Deposit without wallet ─────────────────────────────────────────────────
console.log("\n[3] Deposit attempt (no wallet → 404 expected)");

const depositRes = await post(`/v1/stakes/${stakeOfferId}/deposit`, {
  playerId: "u_stake_white",
}) as { error?: string };

ok("Deposit without wallet → wallet_not_found", depositRes.error === "wallet_not_found", depositRes);

// ── 4. Open on-chain (no funded wallet → error) ───────────────────────────────
console.log("\n[4] Open on-chain (no funded wallet → error expected)");

const openRes = await post(`/v1/stakes/${stakeOfferId}/open`, {
  gameId:          "g_fake001",
  chainGameId:     DUMMY_GAME,
  whiteAddr:       DUMMY_WHITE,
  blackAddr:       DUMMY_BLACK,
  fundDeadlineSec: 10,
}) as { matchId?: string; error?: string };

ok("Open on-chain without funds → error field present", !!openRes.error, openRes);

// ── 5. 404 on unknown stake ───────────────────────────────────────────────────
console.log("\n[5] 404 on unknown stake offer");

const notFound = await get("/v1/stakes/so_nonexistent") as { error?: string };
ok("Unknown stake → not_found", notFound.error === "not_found", notFound);

// ── 6. Wallet page without wallet ─────────────────────────────────────────────
console.log("\n[6] Wallet page (no wallet user → 404)");

const walletNoWallet = await get("/v1/wallet/u_stake_white") as { error?: string };
ok("Wallet without wallet → wallet_not_found", walletNoWallet.error === "wallet_not_found", walletNoWallet);

// ── 7. Wallet page for bot_3 (has a real Circle wallet) ───────────────────────
console.log("\n[7] Wallet page for bot_3");

const bot3 = await get("/v1/wallet/bot_3") as {
  walletAddress?: string; balanceDisplay?: string; isTestnet?: boolean; error?: string;
};

ok("bot_3 wallet → walletAddress",  !!bot3.walletAddress,   bot3);
ok("bot_3 wallet → balanceDisplay", !!bot3.balanceDisplay,  bot3);
ok("bot_3 wallet → isTestnet=true", bot3.isTestnet === true, bot3.isTestnet);

// ── 8. Settle/cancel/timeout on nonexistent ───────────────────────────────────
console.log("\n[8] Settle/cancel/timeout on nonexistent offer");

const settleRes  = await post("/v1/stakes/so_fake/settle", {}) as { error?: string };
const cancelRes  = await post("/v1/stakes/so_fake/cancel", {}) as { error?: string };
const tmoutRes   = await post("/v1/stakes/so_fake/timeout-refund", {}) as { error?: string };

ok("Settle nonexistent → not_found",         settleRes.error  === "not_found", settleRes);
ok("Cancel nonexistent → not_found",         cancelRes.error  === "not_found", cancelRes);
ok("Timeout-refund nonexistent → not_found", tmoutRes.error   === "not_found", tmoutRes);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(50));
console.log(`Stage 6 smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
