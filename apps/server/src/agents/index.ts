/**
 * Agent management: registration, API key verification, wallet creation.
 */
import { createHash, randomBytes } from "crypto";
import { sql } from "../db/client.ts";
import { cfg } from "../config/index.ts";
import { nanoid } from "../util/ids.ts";
import { redis } from "../db/redis.ts";

/** An agent that called the API recently counts as connected for the abandonment rule. */
export function markSeen(agentId: string): void {
  redis.set(`seen:${agentId}`, "1", "EX", 75).catch(() => {});
}

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
    const { createWallet, uuidV5 } = await import("../chain/circle.ts");
    // Circle requires a UUID idempotency key; derive a stable one per agent.
    const wallets = await createWallet(uuidV5(`agent-wallet:${id}`));
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

export class AgentUpdateError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 | 409) { super(message); }
}

/**
 * Rename an agent or change its declared model. The agent keeps its id, wallet,
 * key or connector sign-in, rating and games. Names are looked up live, so old
 * games show the new name.
 */
export async function updateAgent(
  agentId: string,
  ownerId: string,
  patch: { name?: unknown; modelNote?: unknown },
): Promise<AgentRecord> {
  const rows = await sql<{ id: string; owner_id: string; status: string }[]>`
    SELECT id, owner_id, status FROM agents WHERE id=${agentId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new AgentUpdateError("Agent not found", 404);
  if (row.owner_id !== ownerId) throw new AgentUpdateError("That agent isn't yours.", 403);

  let name: string | undefined;
  if (patch.name !== undefined) {
    if (typeof patch.name !== "string" || !patch.name.trim()) throw new AgentUpdateError("Name can't be empty.", 400);
    name = patch.name.trim();
    if (name.length > 40) throw new AgentUpdateError("Name must be 40 characters or fewer.", 400);
    if (/openai|anthropic|google|meta|microsoft|deepmind|circle/i.test(name)) {
      throw new AgentUpdateError("Agent name may not imply affiliation with a real company", 400);
    }
  }

  let modelNote: string | null | undefined;
  if (patch.modelNote !== undefined) {
    if (patch.modelNote !== null && typeof patch.modelNote !== "string") throw new AgentUpdateError("Model must be text.", 400);
    const note = (patch.modelNote ?? "").trim();
    if (note.length > 80) throw new AgentUpdateError("Model must be 80 characters or fewer.", 400);
    modelNote = note || null;
  }

  if (name === undefined && modelNote === undefined) throw new AgentUpdateError("Nothing to change.", 400);

  try {
    const updated = await sql<{
      id: string; owner_id: string; name: string;
      model_note: string | null; status: string; created_at: Date;
    }[]>`
      UPDATE agents SET
        name       = COALESCE(${name ?? null}, name),
        model_note = CASE WHEN ${modelNote !== undefined} THEN ${modelNote ?? null} ELSE model_note END
      WHERE id=${agentId} AND owner_id=${ownerId}
      RETURNING id, owner_id, name, model_note, status, created_at
    `;
    const r = updated[0]!;
    return {
      id: r.id, ownerId: r.owner_id, name: r.name, modelNote: r.model_note,
      status: r.status as "active" | "suspended", createdAt: r.created_at,
    };
  } catch (e) {
    if (/duplicate|unique/i.test((e as Error).message)) throw new AgentUpdateError("That name is taken. Try another.", 409);
    throw e;
  }
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
  markSeen(r.id);
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
