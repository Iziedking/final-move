/**
 * Tests for duels and the open lobby, against a real Postgres and Redis.
 * Run with: bun test apps/server/src/agents/duels.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";

if (process.env.WITHDRAW_TEST_DB !== "1" || process.env.NETWORK === "mainnet") {
  throw new Error("Refusing to run: set WITHDRAW_TEST_DB=1 and point DATABASE_URL at a throwaway test database (never mainnet).");
}

import { sql } from "../db/client.ts";
import { redis } from "../db/redis.ts";
import { runMigrations } from "../db/migrate.ts";
import { createDuel, joinDuel, listOpenDuels, publicDuel, DuelError } from "./duels.ts";

const PERSON = "u_test_duel_1";
const AGENT = "ag_testdu01";
const codes: string[] = [];

beforeAll(async () => {
  await runMigrations();
  await sql`INSERT INTO users (id, handle) VALUES (${PERSON}, 'duel_person') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO agents (id, owner_id, name, api_key_hash, model_note, status) VALUES (${AGENT}, ${PERSON}, 'DuelTestBot', 'x3', 'Test model', 'active') ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO wallets (id, owner_type, owner_id, circle_wallet_id, address, chain) VALUES
      ('w_testdu01', 'user',  ${PERSON}, 'cw_test_du_1', '0x3333333333333333333333333333333333333333', 'ARC'),
      ('w_testdu02', 'agent', ${AGENT},  'cw_test_du_2', '0x4444444444444444444444444444444444444444', 'ARC')
    ON CONFLICT DO NOTHING
  `;
});

afterAll(async () => {
  for (const c of codes) { await redis.del(`duel:${c}`); await redis.zrem("duels:open", c); }
  await sql`DELETE FROM wallets WHERE id IN ('w_testdu01', 'w_testdu02')`;
  await sql`DELETE FROM agents WHERE id=${AGENT}`;
  await sql`DELETE FROM users WHERE id=${PERSON}`;
});

describe("duels", () => {
  it("lets a person post a duel that shows up in the lobby", async () => {
    const d = await createDuel({ id: PERSON, kind: "user" }, { timeControl: "5+0" });
    codes.push(d.code);
    expect(d.timeControl).toBe("5+0");
    expect(d.open).toBe(true);
    const lobby = await listOpenDuels();
    const mine = lobby.find((x) => x.code === d.code);
    expect(mine?.creator.kind).toBe("user");
    expect(mine?.creator.name).toBe("@duel_person");
  });

  it("keeps a private duel out of the lobby but still joinable by code", async () => {
    const d = await createDuel({ id: AGENT, kind: "agent" }, { open: false });
    codes.push(d.code);
    expect((await listOpenDuels()).some((x) => x.code === d.code)).toBe(false);
    const pub = await publicDuel(d.code);
    expect(pub?.creator.model).toBe("Test model");
  });

  it("won't let the creator join their own duel", async () => {
    const d = await createDuel({ id: PERSON, kind: "user" }, {});
    codes.push(d.code);
    let err: unknown = null;
    try { await joinDuel({ id: PERSON, kind: "user" }, d.code); } catch (e) { err = e; }
    expect(err instanceof DuelError && err.status === 409).toBe(true);
  });

  it("rejects an unknown time control and an expired code", async () => {
    let bad: unknown = null;
    try { await createDuel({ id: PERSON, kind: "user" }, { timeControl: "1+0" }); } catch (e) { bad = e; }
    expect(bad instanceof DuelError && bad.status === 400).toBe(true);
    let gone: unknown = null;
    try { await joinDuel({ id: AGENT, kind: "agent" }, "duel-00000000"); } catch (e) { gone = e; }
    expect(gone instanceof DuelError && gone.status === 404).toBe(true);
  });
});
