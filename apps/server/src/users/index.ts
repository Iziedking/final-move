/**
 * Signed-in users: profile row plus their own Circle wallet.
 * Called whenever the web server mints a user token, so a user always has a
 * wallet before their first game, even on a fresh database.
 */
import { sql } from "../db/client.ts";
import { cfg } from "../config/index.ts";
import { createWallet, uuidV5 } from "../chain/circle.ts";

// Display names change rarely; a small cache keeps game-state builds off the database.
const nameCache = new Map<string, { name: string; at: number }>();
const NAME_TTL_MS = 5 * 60_000;

/** The name people see for a player: X handle, agent name, bot name, or "Guest". */
export async function displayName(id: string, kind: string): Promise<string> {
  if (id.startsWith("guest")) return "Guest";
  const hit = nameCache.get(id);
  if (hit && Date.now() - hit.at < NAME_TTL_MS) return hit.name;
  let name = id;
  try {
    if (kind === "bot") {
      const { getBot } = await import("../bots/index.ts");
      name = getBot(id)?.name ?? id;
    } else if (kind === "agent") {
      const rows = await sql<{ name: string }[]>`SELECT name FROM agents WHERE id=${id} LIMIT 1`;
      name = rows[0]?.name ?? id;
    } else {
      const rows = await sql<{ handle: string }[]>`SELECT handle FROM users WHERE id=${id} LIMIT 1`;
      name = rows[0]?.handle ?? id;
    }
  } catch {
    return id;
  }
  nameCache.set(id, { name, at: Date.now() });
  return name;
}

export async function ensureUser(
  userId: string,
  profile: { handle?: string; avatar?: string } = {},
): Promise<{ walletId: string; address: string }> {
  const handle = profile.handle?.trim() || userId;
  await sql`
    INSERT INTO users (id, handle, avatar, x_id)
    VALUES (${userId}, ${handle}, ${profile.avatar ?? null}, ${userId})
    ON CONFLICT (id) DO UPDATE SET
      handle = COALESCE(NULLIF(${profile.handle ?? ""}, ''), users.handle),
      avatar = COALESCE(${profile.avatar ?? null}, users.avatar)
  `;

  const existing = await sql<{ circle_wallet_id: string; address: string }[]>`
    SELECT circle_wallet_id, address FROM wallets
    WHERE owner_type='user' AND owner_id=${userId} LIMIT 1
  `;
  if (existing[0]) return { walletId: existing[0].circle_wallet_id, address: existing[0].address };

  // The idempotency key is stable per user, so a retry returns the same wallet.
  const [wallet] = await createWallet(uuidV5(`user-wallet:${userId}`), 1);
  if (!wallet) throw new Error(`wallet creation returned nothing for ${userId}`);
  await sql`
    INSERT INTO wallets (id, owner_type, owner_id, circle_wallet_id, address, chain)
    VALUES (${"w_u_" + uuidV5(userId).slice(0, 12)}, 'user', ${userId}, ${wallet.id}, ${wallet.address}, ${cfg.CIRCLE_CHAIN})
    ON CONFLICT DO NOTHING
  `;
  return { walletId: wallet.id, address: wallet.address };
}
