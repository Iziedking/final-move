/**
 * Tests for renaming an agent and changing its model, against a real Postgres.
 * Run with: bun test apps/server/src/agents/update.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";

if (process.env.WITHDRAW_TEST_DB !== "1" || process.env.NETWORK === "mainnet") {
  throw new Error("Refusing to run: set WITHDRAW_TEST_DB=1 and point DATABASE_URL at a throwaway test database (never mainnet).");
}

import { sql } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { updateAgent, AgentUpdateError } from "./index.ts";

const OWNER = "u_test_upd_1";
const OTHER = "u_test_upd_2";
const AGENT = "ag_testup01";
const TAKEN = "ag_testup02";

async function err(p: Promise<unknown>): Promise<AgentUpdateError | null> {
  try { await p; return null; } catch (e) { return e instanceof AgentUpdateError ? e : null; }
}

beforeAll(async () => {
  await runMigrations();
  await sql`INSERT INTO users (id, handle) VALUES (${OWNER}, 'upd_owner'), (${OTHER}, 'upd_other') ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO agents (id, owner_id, name, api_key_hash, model_note, status) VALUES
      (${AGENT}, ${OWNER}, 'UpdTestBot', 'x4', 'Old model', 'active'),
      (${TAKEN}, ${OTHER}, 'UpdTakenName', 'x5', null, 'active')
    ON CONFLICT (id) DO NOTHING
  `;
});

afterAll(async () => {
  await sql`DELETE FROM agents WHERE id IN (${AGENT}, ${TAKEN})`;
  await sql`DELETE FROM users WHERE id IN (${OWNER}, ${OTHER})`;
});

describe("updateAgent", () => {
  it("lets the owner rename the agent and change its model, keeping its id", async () => {
    const a = await updateAgent(AGENT, OWNER, { name: "  UpdRenamed ", modelNote: "Claude Opus 5.5" });
    expect(a.id).toBe(AGENT);
    expect(a.name).toBe("UpdRenamed");
    expect(a.modelNote).toBe("Claude Opus 5.5");
  });

  it("changes only the model when no name is given, and clears it with an empty string", async () => {
    const a = await updateAgent(AGENT, OWNER, { modelNote: "" });
    expect(a.name).toBe("UpdRenamed");
    expect(a.modelNote).toBeNull();
  });

  it("refuses someone who doesn't own the agent", async () => {
    expect((await err(updateAgent(AGENT, OTHER, { name: "Hijack" })))?.status).toBe(403);
    const rows = await sql<{ name: string }[]>`SELECT name FROM agents WHERE id=${AGENT}`;
    expect(rows[0]?.name).toBe("UpdRenamed");
  });

  it("refuses a name that is taken, empty, too long or implies a company", async () => {
    expect((await err(updateAgent(AGENT, OWNER, { name: "UpdTakenName" })))?.status).toBe(409);
    expect((await err(updateAgent(AGENT, OWNER, { name: "   " })))?.status).toBe(400);
    expect((await err(updateAgent(AGENT, OWNER, { name: "x".repeat(41) })))?.status).toBe(400);
    expect((await err(updateAgent(AGENT, OWNER, { name: "AnthropicBot" })))?.status).toBe(400);
    expect((await err(updateAgent(AGENT, OWNER, {})))?.status).toBe(400);
  });

  it("returns 404 for an unknown agent", async () => {
    expect((await err(updateAgent("ag_nope0000", OWNER, { name: "Ghost" })))?.status).toBe(404);
  });
});
