/**
 * One-time script: create referee, treasury, and two test player wallets
 * on ARC-TESTNET inside your existing wallet set.
 *
 * Usage:
 *   bun run scripts/create-wallets.ts
 *
 * Requires in .env:
 *   CIRCLE_API_KEY
 *   ENTITY_SECRET
 *   CIRCLE_WALLET_SET_ID
 */

import {
  initiateDeveloperControlledWalletsClient,
} from "@circle-fin/developer-controlled-wallets";

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.ENTITY_SECRET;
const walletSetId = process.env.CIRCLE_WALLET_SET_ID;

if (!apiKey || !entitySecret || !walletSetId) {
  console.error(
    "Missing CIRCLE_API_KEY, ENTITY_SECRET, or CIRCLE_WALLET_SET_ID in .env"
  );
  process.exit(1);
}

const client = initiateDeveloperControlledWalletsClient({
  apiKey,
  entitySecret,
});

const wallets = [
  { name: "referee",      idempotencyKey: "finalmove-referee-v1" },
  { name: "treasury",     idempotencyKey: "finalmove-treasury-v1" },
  { name: "player_white", idempotencyKey: "finalmove-player-white-v1" },
  { name: "player_black", idempotencyKey: "finalmove-player-black-v1" },
];

console.log(`Creating ${wallets.length} wallets in wallet set ${walletSetId} on ARC-TESTNET...\n`);

for (const w of wallets) {
  try {
    const res = await client.createWallets({
      accountType: "EOA",
      blockchains: ["ARC-TESTNET"],
      count: 1,
      walletSetId,
      metadata: [{ name: w.name, refId: w.idempotencyKey }],
    });

    const wallet = res.data?.wallets?.[0];
    if (!wallet) {
      console.error(`  ${w.name}: no wallet returned`);
      continue;
    }

    console.log(`  ${w.name}`);
    console.log(`    Wallet ID : ${wallet.id}`);
    console.log(`    Address   : ${wallet.address}`);
    console.log();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ${w.name}: ERROR — ${msg}`);
  }
}

console.log("Done. Copy the Wallet IDs above into your .env:");
console.log("  REFEREE_WALLET_ID=...");
console.log("  TREASURY_WALLET_ID=...");
console.log("(player wallet IDs are needed for the Stage 0 measurement script)");
