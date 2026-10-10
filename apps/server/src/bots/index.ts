/**
 * House bots: five levels using the vendored search.
 * Each bot has a fixed id, a name, and a wallet loaded from BOT_WALLET_IDS env.
 * On game start, getBotMove() is called and the result is fed to the referee.
 */
import { bestCandidates, legalMoves, moveToUci } from "@final-move/chess";
import { cfg } from "../config/index.ts";
import { sql } from "../db/client.ts";
import { createWallet, uuidV5 } from "../chain/circle.ts";
import type { Position } from "@final-move/chess";

export interface BotProfile {
  id: string;         // "bot_1" .. "bot_5"
  name: string;
  depth: number;
  randomness: number; // 0..1, fraction of moves chosen at random
  walletId: string;
  address: string;
}

const BOT_DEFS = [
  { id: "bot_1", name: "Pawnderer",  depth: 1, randomness: 0.8 },
  { id: "bot_2", name: "Knightfall", depth: 1, randomness: 0.4 },
  { id: "bot_3", name: "Rookery",    depth: 2, randomness: 0.2 },
  { id: "bot_4", name: "Bishopric",  depth: 3, randomness: 0.05 },
  { id: "bot_5", name: "GrandBot",   depth: 4, randomness: 0.0 },
];

let _bots: BotProfile[] | null = null;

export async function loadBots(): Promise<BotProfile[]> {
  if (_bots) return _bots;

  const walletIds = cfg.BOT_WALLET_IDS
    ? cfg.BOT_WALLET_IDS.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  _bots = await Promise.all(
    BOT_DEFS.map(async (def, i) => {
      const wid = walletIds[i];
      if (!wid) {
        console.warn(`[bots] no wallet for ${def.id} — bot will have empty address`);
        return { ...def, walletId: "", address: "" };
      }

      // Look up the wallet address in our DB
      const rows = await sql<{ address: string }[]>`
        SELECT address FROM wallets WHERE circle_wallet_id=${wid} LIMIT 1
      `;
      const address = rows[0]?.address ?? "";
      return { ...def, walletId: wid, address };
    }),
  );

  return _bots;
}

export function getBot(botId: string): BotProfile | undefined {
  return _bots?.find((b) => b.id === botId);
}

/** Return a UCI move for a bot given the current position. */
export async function getBotMove(
  botId: string,
  position: Position,
): Promise<string | null> {
  const bot = getBot(botId);
  if (!bot) return null;
  const legal = legalMoves(position);
  if (!legal.length) return null;

  // With randomness > 0, sometimes pick a random legal move instead of the engine's choice
  if (bot.randomness > 0 && Math.random() < bot.randomness) {
    const rnd = legal[Math.floor(Math.random() * legal.length)]!;
    return moveToUci(rnd);
  }

  // Use the vendored search — tier maps roughly to depth (tiers 1-5)
  const tier = Math.min(5, Math.max(1, bot.depth));
  const candidates = bestCandidates(position, tier, 1);
  if (!candidates.length) return null;
  return candidates[0]!.uci;
}

/** Create wallets for all bots and print them for .env */
export async function createBotWallets(): Promise<void> {
  console.log("Creating wallets for 5 house bots…");
  for (const def of BOT_DEFS) {
    const idempKey = uuidV5(`bot-wallet-${def.id}-v1`);
    const [wallet] = await createWallet(idempKey, 1);
    if (!wallet) throw new Error(`Failed to create wallet for ${def.id}`);

    // Upsert into wallets table
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM wallets WHERE circle_wallet_id=${wallet.id} LIMIT 1
    `;
    if (!rows.length) {
      await sql`
        INSERT INTO wallets (id, owner_type, owner_id, circle_wallet_id, address, chain)
        VALUES (${`w_${def.id}`}, 'bot', ${def.id}, ${wallet.id}, ${wallet.address}, ${cfg.CIRCLE_CHAIN})
      `;
    }
    console.log(`  ${def.id}  walletId=${wallet.id}  address=${wallet.address}`);
  }
  console.log("\nAdd to .env as BOT_WALLET_IDS (comma-separated).");
}
