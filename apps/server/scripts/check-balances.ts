/**
 * One-shot balance check: referee, treasury, and all bots.
 */
import { loadBots } from "../src/bots/index.ts";
import { getUsdcBalance } from "../src/chain/circle.ts";
import { sql } from "../src/db/client.ts";
import { cfg } from "../src/config/index.ts";

const bots = await loadBots();
console.log("USDC balances:");
for (const b of bots) {
  const bal = b.walletId ? await getUsdcBalance(b.walletId) : 0n;
  const flag = bal < 1_000_000n ? "  ⚠ LOW" : "";
  console.log(`  ${b.id} (${b.walletId.slice(0, 8)}..): ${Number(bal) / 1e6} USDC${flag}`);
}
const refBal  = await getUsdcBalance(cfg.REFEREE_WALLET_ID);
const treaBal = await getUsdcBalance(cfg.TREASURY_WALLET_ID);
console.log(`  referee  : ${Number(refBal)  / 1e6} USDC`);
console.log(`  treasury : ${Number(treaBal) / 1e6} USDC`);

await sql.end();
process.exit(0);
