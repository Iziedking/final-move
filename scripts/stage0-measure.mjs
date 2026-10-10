/**
 * Stage 0 measurement — ESM, run with: bun run scripts/stage0-measure.mjs
 *
 * Sends USDC approve(spender=0x1, amount=0) from player_white via Circle,
 * polls to COMPLETE, and prints the row for docs/arc-facts.md.
 */

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const PLAYER_WHITE_WALLET_ID = "2afe8339-8905-5ff2-beed-bdd8c37a2f31";
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.ENTITY_SECRET;

if (!apiKey || !entitySecret) {
  console.error("ERROR: Missing CIRCLE_API_KEY or ENTITY_SECRET in .env");
  process.exit(1);
}

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("Stage 0 measurement: sending USDC approve(0) from player_white...\n");

const t0 = Date.now();
const idempotencyKey = crypto.randomUUID();

// 1. Submit
let createRes;
try {
  createRes = await client.createContractExecutionTransaction({
    walletId: PLAYER_WHITE_WALLET_ID,
    contractAddress: USDC_ADDRESS,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: ["0x0000000000000000000000000000000000000001", "0"],
    feeLevel: "HIGH",
    idempotencyKey,
  });
} catch (e) {
  console.error("createContractExecutionTransaction failed:", e?.message ?? e);
  process.exit(1);
}

const txId = createRes?.data?.id;
const initState = createRes?.data?.state ?? "";

if (!txId) {
  console.error("No TX ID returned:", JSON.stringify(createRes, null, 2));
  process.exit(1);
}

console.log(`  Circle TX ID  : ${txId}`);
console.log(`  Initial state : ${initState}`);
console.log(`  Submitted at  : ${new Date(t0).toISOString()}`);
console.log("\n  Polling every 2 s (up to 120 s)...\n");

// 2. Poll to terminal
const TERMINAL = new Set(["COMPLETE", "FAILED", "DENIED", "CANCELLED"]);
let sentAt = null;
let completeAt = null;
let txHash = "";
let gasUsed = "";
let lastState = initState;

for (let i = 0; i < 60; i++) {
  await sleep(2000);

  let pollRes;
  try { pollRes = await client.getTransaction({ id: txId }); } catch { continue; }

  const tx = pollRes?.data?.transaction;
  if (!tx) continue;

  const state = tx.state ?? "";

  if (state !== lastState) {
    console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s]  ${lastState} → ${state}`);
    lastState = state;
  }

  if (["SENT", "CONFIRMED", "COMPLETE"].includes(state) && !sentAt) {
    sentAt = Date.now();
    txHash = tx.txHash ?? "";
  }

  if (state === "COMPLETE") {
    completeAt = Date.now();
    txHash  = tx.txHash  ?? txHash;
    gasUsed = String(tx.gasUsed ?? "");
    break;
  }

  if (TERMINAL.has(state)) {
    console.error(`\n  Transaction ended in ${state}:`);
    console.error(JSON.stringify(tx, null, 2));
    process.exit(1);
  }
}

if (!completeAt) {
  console.error("\n  Timed out — transaction not COMPLETE after 120 s.");
  process.exit(1);
}

const reqToSentMs  = sentAt ? sentAt - t0 : null;
const sentToCompMs = sentAt ? completeAt - sentAt : null;
const totalMs      = completeAt - t0;

console.log("\n─────────────────────────────────────────────────────────────────");
console.log("  Stage 0 COMPLETE");
console.log("─────────────────────────────────────────────────────────────────");
console.log(`  Circle TX ID    : ${txId}`);
console.log(`  On-chain hash   : ${txHash}`);
console.log(`  Request → SENT  : ${reqToSentMs ?? "n/a"} ms`);
console.log(`  SENT → COMPLETE : ${sentToCompMs ?? "n/a"} ms`);
console.log(`  Total           : ${totalMs} ms`);
console.log(`  Gas used        : ${gasUsed || "(see explorer)"}`);
console.log(`  Explorer        : https://explorer.testnet.arc.io/tx/${txHash}`);
console.log("─────────────────────────────────────────────────────────────────");
console.log("\nAdd this row to docs/arc-facts.md:\n");
console.log(
  `| Stage 0 test tx | hash \`${txHash}\` · Circle id \`${txId}\` · req→sent ${reqToSentMs ?? "?"}ms · sent→complete ${sentToCompMs ?? "?"}ms · gas ${gasUsed || "?"} | \`approve(0)\` from player_white on ARC-TESTNET 2026-10-08 |`
);
