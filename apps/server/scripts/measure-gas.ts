/**
 * measure-gas.ts — Stage 9a gas measurement
 *
 * Plays one full bot-vs-bot game on testnet, then reads every transaction
 * from the explorer/RPC to measure:
 *   • createGame   gas used + fee (USDC)
 *   • move         min / median / max gas used + fee
 *   • endGame      gas used + fee
 *   • total game   total fee (USDC)
 *
 * Results are printed and appended to docs/arc-facts.md.
 *
 * Usage:
 *   cd /path/to/final-move
 *   bun run apps/server/scripts/measure-gas.ts
 */

import { createPublicClient, http, formatUnits } from "viem";
import { sql } from "../src/db/client.ts";
import { cfg } from "../src/config/index.ts";

// ── Chain config ──────────────────────────────────────────────────────────────
const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [cfg.ARC_RPC_URL] } },
} as const;

const client = createPublicClient({
  chain: ARC_TESTNET as Parameters<typeof createPublicClient>[0]["chain"],
  transport: http(cfg.ARC_RPC_URL),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUsdc18(wei: bigint): string {
  return formatUnits(wei, 18);
}

function median(arr: bigint[]): bigint {
  if (!arr.length) return 0n;
  const sorted = [...arr].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)]!;
}

// ── Find the most recent bot-vs-bot game that has all moves final ─────────────

console.log("\n=== Final Move — Gas Measurement ===\n");

const gameRows = await sql<{
  id: string; chain_game_id: string; result: string;
  white_id: string; black_id: string;
}[]>`
  SELECT g.id, g.chain_game_id, g.result, g.white_id, g.black_id
  FROM games g
  WHERE g.status = 'ended'
    AND g.white_kind = 'bot' AND g.black_kind = 'bot'
    AND NOT EXISTS (
      SELECT 1 FROM moves m WHERE m.game_id = g.id AND m.state NOT IN ('final','relayed')
    )
  ORDER BY g.ended_at DESC
  LIMIT 1
`;

if (!gameRows[0]) {
  console.error("No fully-final bot-vs-bot game found. Run the Stage 2 smoke first.");
  await sql.end();
  process.exit(1);
}

const game = gameRows[0];
console.log(`Game: ${game.id}  result: ${game.result}  (${game.white_id} vs ${game.black_id})\n`);

// ── Pull all move tx hashes ───────────────────────────────────────────────────

const moveRows = await sql<{ ply: number; tx_hash: string | null; state: string }[]>`
  SELECT ply, tx_hash, state FROM moves
  WHERE game_id = ${game.id} AND tx_hash IS NOT NULL
  ORDER BY ply
`;

// ── Pull createGame and endGame tx hashes from chain_events ──────────────────

const chainEvents = await sql<{
  event_name: string; tx_hash: string;
}[]>`
  SELECT DISTINCT ON (event_name) event_name, tx_hash
  FROM chain_events
  WHERE raw::text ILIKE ${'%' + game.chain_game_id.toLowerCase().slice(2, 20) + '%'}
    AND event_name IN ('GameCreated','GameEnded')
  ORDER BY event_name, block_number DESC
`;

const createTxHash = chainEvents.find((e) => e.event_name === "GameCreated")?.tx_hash;
const endTxHash    = chainEvents.find((e) => e.event_name === "GameEnded")?.tx_hash;

// ── Fetch receipts and compute gas ───────────────────────────────────────────

async function getReceipt(hash: string) {
  try {
    return await client.getTransactionReceipt({ hash: hash as `0x${string}` });
  } catch {
    return null;
  }
}

async function gasAndFee(hash: string | undefined, label: string) {
  if (!hash) {
    console.log(`  ${label}: tx hash not found — skipping`);
    return null;
  }
  const receipt = await getReceipt(hash);
  if (!receipt) {
    console.log(`  ${label}: receipt not found for ${hash}`);
    return null;
  }
  // On Arc, effectiveGasPrice is in native USDC (18 decimals)
  const gasUsed = receipt.gasUsed;
  const gasPrice = receipt.effectiveGasPrice ?? 0n;
  const feeNative18 = gasUsed * gasPrice;
  const feeUsdc6 = feeNative18 / 10n ** 12n; // 18→6 decimals
  console.log(`  ${label}:`);
  console.log(`    gas used:  ${gasUsed.toLocaleString()}`);
  console.log(`    gas price: ${formatUnits(gasPrice, 9)} gwei`);
  console.log(`    fee:       ${formatUsdc18(feeNative18)} USDC (native18)`);
  console.log(`    fee (6d):  ${Number(feeUsdc6) / 1e6} USDC`);
  return { gasUsed, gasPrice, feeNative18, feeUsdc6 };
}

console.log("--- createGame ---");
const createStats = await gasAndFee(createTxHash, "createGame");

console.log("\n--- endGame ---");
const endStats = await gasAndFee(endTxHash, "endGame");

console.log("\n--- moves ---");
const moveGasUsed: bigint[] = [];
const moveFees: bigint[] = [];
let processedMoves = 0;

// Sample up to 10 evenly spaced moves to avoid rate limits
const step = Math.max(1, Math.floor(moveRows.length / 10));
for (let i = 0; i < moveRows.length; i += step) {
  const row = moveRows[i]!;
  const receipt = await getReceipt(row.tx_hash!);
  if (receipt) {
    moveGasUsed.push(receipt.gasUsed);
    moveFees.push(receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n));
    processedMoves++;
  }
}

if (moveGasUsed.length) {
  const minGas  = moveGasUsed.reduce((a, b) => a < b ? a : b);
  const maxGas  = moveGasUsed.reduce((a, b) => a > b ? a : b);
  const medGas  = median(moveGasUsed);
  const minFee  = moveFees.reduce((a, b) => a < b ? a : b);
  const maxFee  = moveFees.reduce((a, b) => a > b ? a : b);
  const medFee  = median(moveFees);
  console.log(`  sampled: ${processedMoves} of ${moveRows.length} moves`);
  console.log(`  gas used: min=${minGas.toLocaleString()}  median=${medGas.toLocaleString()}  max=${maxGas.toLocaleString()}`);
  console.log(`  fee (native18): min=${formatUsdc18(minFee)}  median=${formatUsdc18(medFee)}  max=${formatUsdc18(maxFee)} USDC`);
  console.log(`  fee (6d): min=${Number(minFee / 10n**12n)/1e6}  median=${Number(medFee / 10n**12n)/1e6}  max=${Number(maxFee / 10n**12n)/1e6} USDC`);
}

// ── Total game cost ───────────────────────────────────────────────────────────

const totalFeeNative18 =
  (createStats?.feeNative18 ?? 0n) +
  (endStats?.feeNative18 ?? 0n) +
  moveFees.reduce((s, f) => s + f, 0n);

const totalPlies = moveRows.length;
const projectedMoveFeeNative = moveGasUsed.length
  ? median(moveFees) * BigInt(totalPlies)
  : 0n;
const projectedTotal = (createStats?.feeNative18 ?? 0n) + projectedMoveFeeNative + (endStats?.feeNative18 ?? 0n);

console.log("\n--- totals ---");
console.log(`  plies played: ${totalPlies}`);
console.log(`  measured total (sampled): ${formatUsdc18(totalFeeNative18)} USDC`);
console.log(`  projected full game (${totalPlies} plies): ${formatUsdc18(projectedTotal)} USDC`);
console.log(`  projected 80-ply game: ${formatUsdc18(projectedMoveFeeNative / BigInt(totalPlies || 1) * 80n + (createStats?.feeNative18 ?? 0n) + (endStats?.feeNative18 ?? 0n))} USDC`);

// ── Append to docs/arc-facts.md ───────────────────────────────────────────────

import { appendFileSync } from "fs";
import { join } from "path";

const now = new Date().toISOString().slice(0, 10);
const medGasVal = median(moveGasUsed);
const medFeeSixDec = moveGasUsed.length ? Number(median(moveFees) / 10n**12n) / 1e6 : 0;
const projectedUsdc6 = Number(projectedTotal / 10n**12n) / 1e6;

const row = `
## Gas measurement — ${now} (game ${game.id}, ${totalPlies} plies, chain id 5042002)

| Tx type | Gas used | Fee (USDC) |
|---|---|---|
| createGame | ${createStats?.gasUsed?.toLocaleString() ?? "n/a"} | ${createStats ? (Number(createStats.feeUsdc6) / 1e6).toFixed(6) : "n/a"} |
| move (median) | ${medGasVal.toLocaleString()} | ${medFeeSixDec.toFixed(6)} |
| endGame | ${endStats?.gasUsed?.toLocaleString() ?? "n/a"} | ${endStats ? (Number(endStats.feeUsdc6) / 1e6).toFixed(6) : "n/a"} |
| **full ${totalPlies}-ply game (projected)** | — | **${projectedUsdc6.toFixed(4)}** |
| **projected 80-ply game** | — | **${(Number((projectedMoveFeeNative / BigInt(totalPlies || 1) * 80n + (createStats?.feeNative18 ?? 0n) + (endStats?.feeNative18 ?? 0n)) / 10n**12n) / 1e6).toFixed(4)}** |

Gas price used: ${createStats ? formatUnits(createStats.gasPrice, 9) : "~25"} gwei (testnet).
`;

const factsPath = join(new URL("../../../docs/arc-facts.md", import.meta.url).pathname);
try {
  appendFileSync(factsPath, row);
  console.log(`\n✓ Appended gas table to docs/arc-facts.md`);
} catch (e) {
  console.warn("Could not write to arc-facts.md:", e);
}

await sql.end();
console.log("\n=== Done ===\n");
