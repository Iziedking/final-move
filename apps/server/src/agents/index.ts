/**
 * Agent management: registration, API key verification, wallet creation.
 */
import { createHash, randomBytes } from "crypto";
import { sql } from "../db/client.ts";
import { cfg } from "../config/index.ts";
import { nanoid } from "../util/ids.ts";

// ── Key helpers ────────────────────────────────────────────────────────────────

/** Generate a new API key — format: `fmk_<random32hex>` */
export function generateApiKey(): string {
  return "fmk_" + randomBytes(32).toString("hex");
}

/** Hash an API key for DB storage */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// ── Registration ───────────────────────────────────────────────────────────────

export interface AgentRecord {
  id:        string;
  ownerId:   string;
  name:      string;
  modelNote: string | null;
  status:    "active" | "suspended";
  createdAt: Date;
}

export async function registerAgent(opts: {
  ownerId:   string;
  name:      string;
  modelNote?: string;
}): Promise<{ agent: AgentRecord; apiKey: string; walletAddress: string; walletId: string }> {
  // Name uniqueness + owner limit checked in DB (UNIQUE + count query)
  const count = await sql<{ n: string }[]>`
    SELECT COUNT(*) as n FROM agents WHERE owner_id=${opts.ownerId} AND status='active'
  `;
  if (Number(count[0]!.n) >= 5) {
    throw new Error("Owner already has 5 active agents");
  }

  // Validate name (no impersonation of real entities — basic check)
  const forbidden = /openai|anthropic|google|meta|microsoft|deepmind|circle/i;
  if (forbidden.test(opts.name)) {
    throw new Error("Agent name may not imply affiliation with a real company");
  }

  const id     = "ag_" + nanoid(8);
  const apiKey = generateApiKey();
  const hash   = hashApiKey(apiKey);

  await sql`
    INSERT INTO agents (id, owner_id, name, api_key_hash, model_note, status)
    VALUES (${id}, ${opts.ownerId}, ${opts.name}, ${hash}, ${opts.modelNote ?? null}, 'active')
  `;

  // Create a Circle wallet for this agent
  let walletAddress = "";
  let walletId      = "";
  try {
    const { createWallet } = await import("../chain/circle.ts");
    const wallets = await createWallet(`agent:${id}`);
    const w = wallets[0];
    if (w) {
      walletAddress = w.address;
      walletId      = w.id;
      const wid = "w_" + nanoid(8);
      await sql`
        INSERT INTO wallets (id, owner_type, owner_id, circle_wallet_id, address, chain)
        VALUES (${wid}, 'agent', ${id}, ${walletId}, ${walletAddress}, ${cfg.CIRCLE_CHAIN})
      `;
    }
  } catch (e) {
    console.error("[agents] wallet creation failed:", (e as Error).message);
    // Agent is still registered; wallet can be created later
  }

  const agent: AgentRecord = {
    id,
    ownerId:   opts.ownerId,
    name:      opts.name,
    modelNote: opts.modelNote ?? null,
    status:    "active",
    createdAt: new Date(),
  };

  return { agent, apiKey, walletAddress, walletId };
}

/** Verify an API key and return the agent record, or null if invalid. */
export async function verifyApiKey(key: string): Promise<AgentRecord | null> {
  if (!key.startsWith("fmk_")) return null;
  const hash = hashApiKey(key);
  const rows = await sql<{
    id: string; owner_id: string; name: string;
    model_note: string | null; status: string; created_at: Date;
  }[]>`
    SELECT id, owner_id, name, model_note, status, created_at
    FROM agents WHERE api_key_hash=${hash} AND status='active'
    LIMIT 1
  `;
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id:        r.id,
    ownerId:   r.owner_id,
    name:      r.name,
    modelNote: r.model_note,
    status:    r.status as "active" | "suspended",
    createdAt: r.created_at,
  };
}

/** Get agent wallet for a given agent id */
export async function getAgentWallet(agentId: string): Promise<{ address: string; walletId: string } | null> {
  const rows = await sql<{ address: string; circle_wallet_id: string }[]>`
    SELECT address, circle_wallet_id FROM wallets
    WHERE owner_type='agent' AND owner_id=${agentId}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return { address: rows[0].address, walletId: rows[0].circle_wallet_id };
}

/** List all agents owned by a user */
export async function listAgents(ownerId: string): Promise<AgentRecord[]> {
  const rows = await sql<{
    id: string; owner_id: string; name: string;
    model_note: string | null; status: string; created_at: Date;
  }[]>`
    SELECT id, owner_id, name, model_note, status, created_at
    FROM agents WHERE owner_id=${ownerId}
    ORDER BY created_at DESC
  `;
  return rows.map((r) => ({
    id:        r.id,
    ownerId:   r.owner_id,
    name:      r.name,
    modelNote: r.model_note,
    status:    r.status as "active" | "suspended",
    createdAt: r.created_at,
  }));
}
