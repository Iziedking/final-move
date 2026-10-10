/**
 * One-time script: create 5 bot wallets on ARC-TESTNET.
 * Run: cd apps/server && bun run bot-wallets
 */
import "../src/config/index.ts"; // validates env
import { createBotWallets } from "../src/bots/index.ts";

createBotWallets()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
