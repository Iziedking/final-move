/**
 * One-shot: send USDC from treasury to a bot wallet address.
 * Usage: bun run fund-bot <walletAddress> <amount>
 */
import "../src/config/index.ts";
import { createTokenTransfer } from "../src/chain/circle.ts";
import { cfg } from "../src/config/index.ts";
import { randomUUID } from "crypto";

const [,, dest, amount = "5"] = process.argv;
if (!dest) { console.error("Usage: fund-bot <address> <amount>"); process.exit(1); }

console.log(`Sending ${amount} USDC from treasury → ${dest}`);
const tx = await createTokenTransfer({
  idempotencyKey: randomUUID(),
  sourceWalletId: cfg.TREASURY_WALLET_ID,
  destinationAddress: dest,
  tokenAddress: cfg.USDC_ADDRESS,
  amount,
  feeLevel: "HIGH",
});
console.log("tx id:", tx.id, "state:", tx.state);
process.exit(0);
