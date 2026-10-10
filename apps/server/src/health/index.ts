import { createPublicClient, http } from "viem";
import { cfg } from "../config/index.ts";
import { redis } from "../db/redis.ts";
import { sql } from "../db/client.ts";
import { getIndexerLag } from "../indexer/index.ts";
import { getUsdcBalance } from "../chain/circle.ts";

const client = createPublicClient({ transport: http(cfg.ARC_RPC_URL) });

export async function getHealth() {
  const [chainHead, redisOk, dbOk, treasuryBal] = await Promise.allSettled([
    client.getBlockNumber(),
    redis.ping(),
    sql`SELECT 1`.then(() => true),
    getUsdcBalance(cfg.TREASURY_WALLET_ID),
  ]);

  // Daily top-up spend
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const topupRows = await sql<{ total: string }[]>`
    SELECT COALESCE(SUM(amount_usdc6), 0) as total FROM topups WHERE created_at >= ${today.toISOString()}
  `.catch(() => [{ total: "0" }]);

  return {
    ok: chainHead.status === "fulfilled" && redisOk.status === "fulfilled" && dbOk.status === "fulfilled",
    chain: {
      head: chainHead.status === "fulfilled" ? String(chainHead.value) : null,
      rpc: chainHead.status === "fulfilled" ? "ok" : "error",
    },
    indexer: {
      lagBlocks: getIndexerLag(),
    },
    redis: redisOk.status === "fulfilled" ? "ok" : "error",
    db:    dbOk.status === "fulfilled"    ? "ok" : "error",
    treasury: {
      balanceUsdc6: treasuryBal.status === "fulfilled" ? String(treasuryBal.value) : null,
    },
    topupTodayUsdc6: topupRows[0]?.total ?? "0",
    ts: new Date().toISOString(),
  };
}
