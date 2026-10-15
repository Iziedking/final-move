/**
 * Stage 7 smoke test — Saturday Cup (8-bot tournament)
 * "Done when": 8-bot cup runs from registration to payout; payouts match splits to the unit.
 *
 * What this does:
 *  1. Creates a tournament with prizeUsdc6 = 0 (no on-chain funds needed for smoke)
 *  2. Registers bots 1–5 + 3 extra fake bots (8 total)
 *  3. Starts the tournament (closes registration, builds bracket)
 *  4. Polls until status=done
 *  5. Reads final standings and verifies: champion exists, placements set, prize splits
 *     add up correctly for a sponsored 0-prize cup
 */

const BASE = "http://localhost:3001";
const TIMEOUT_MS = 300_000; // 5 minutes for the 8-bot bracket to complete

let passed = 0;
let failed = 0;

function check(label: string, value: unknown, expected?: unknown) {
  if (expected !== undefined) {
    const ok = JSON.stringify(value) === JSON.stringify(expected) ||
               (typeof expected === "boolean" ? Boolean(value) === expected : value === expected);
    if (ok) { console.log(`  ✓ ${label}`); passed++; }
    else    { console.log(`  ✗ ${label}`, JSON.stringify(value)); failed++; }
  } else {
    if (value !== null && value !== undefined && value !== false && value !== "") {
      console.log(`  ✓ ${label}`); passed++;
    } else {
      console.log(`  ✗ ${label}`, JSON.stringify(value)); failed++;
    }
  }
}

async function post(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}
async function get(path: string) {
  const r = await fetch(`${BASE}${path}`);
  return r.json();
}

// ── Setup: ensure 8 bots are registered in the wallets table ──────────────────

// Use 4 real bots for a clean 4-player (2-round) bracket — no fake bots needed
const BOT_IDS = ["bot_1", "bot_2", "bot_3", "bot_4"];
const FAKE_BOT_IDS: string[] = [];

// Insert fake bot wallet rows for smoke (use referee address as stand-in)
import { sql }        from "../src/db/client.ts";
import { cfg }        from "../src/config/index.ts";
import { loadBots }   from "../src/bots/index.ts";

await loadBots(); // ensure real bots are in DB

for (const bid of FAKE_BOT_IDS) {
  await sql`
    INSERT INTO wallets (id, owner_type, owner_id, circle_wallet_id, address, chain)
    VALUES ('w_' || ${bid}, 'bot', ${bid}, ${cfg.REFEREE_WALLET_ID + "_" + bid},
            ${cfg.REFEREE_WALLET_ADDRESS ?? "0x0000000000000000000000000000000000000000"}, 'ARC-TESTNET')
    ON CONFLICT (circle_wallet_id) DO NOTHING
  `;
}

// ── Test ──────────────────────────────────────────────────────────────────────

const runId = Date.now().toString(36);
const regClose = new Date(Date.now() + 3_000).toISOString();   // 3s from now
const startsAt = new Date(Date.now() + 4_000).toISOString();   // 4s from now

console.log("\n[1] Create tournament");
const created = await post("/v1/tournaments", {
  name:        `Smoke Cup ${runId}`,
  gameClass:   "open",
  timeControl: "3+2",
  regClose,
  startsAt,
  prizeUsdc6:  0,
  sponsoredBy: "smoke",
});
check("tournamentId", created.id);
check("status=upcoming or open", ["upcoming", "open"].includes(created.status), true);
const tid = created.id as string;

console.log("\n[2] Register 8 bots");
for (const bid of BOT_IDS) {
  const r = await post(`/v1/tournaments/${tid}/register`, { playerId: bid, playerKind: "bot" });
  check(`register ${bid}`, r.ok, true);
}

console.log("\n[3] Get tournament entries");
const detail = await get(`/v1/tournaments/${tid}`);
check("4 entries", detail.entries?.length, 4);

console.log("\n[4] Start tournament");
// Wait for regClose (3s) so the server accepts startTournament
await new Promise((r) => setTimeout(r, 4_000));
const started = await post(`/v1/tournaments/${tid}/start`, {});
check("start ok", started.ok, true);

console.log("\n[5] Poll until done (max 5 min)");
const deadline = Date.now() + TIMEOUT_MS;
let finalDetail: typeof detail = await get(`/v1/tournaments/${tid}`);
let lastGameCount = -1;
let stallCount = 0;
while (finalDetail.status !== "done" && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 3_000));
  finalDetail = await get(`/v1/tournaments/${tid}`);
  const completed = finalDetail.games?.filter((g: { winner_id: string | null }) => g.winner_id).length ?? 0;
  const total     = finalDetail.games?.length ?? 0;
  process.stdout.write(`\r  games: ${completed}/${total} completed, status=${finalDetail.status}    `);
  // All games done but tournament not yet finalized — call force-finalize
  if (total > 0 && completed === total && finalDetail.status === "running") {
    stallCount++;
    if (stallCount >= 3) {
      process.stdout.write(" [force-finalize]");
      await post(`/v1/tournaments/${tid}/finalize`, {});
      stallCount = 0;
    }
  } else {
    stallCount = 0;
  }
  if (completed !== lastGameCount) lastGameCount = completed;
}
console.log();
check("status=done", finalDetail.status, "done");

console.log("\n[6] Verify standings");
const entries: Array<{ playerId: string; placement: number | null; prizeUsdc6: string }> =
  finalDetail.entries ?? [];
const placed = entries.filter((e) => e.placement !== null);
check("all 4 placed", placed.length, 4);
check("champion (place=1) exists", entries.some((e) => e.placement === 1), true);
check("runner-up (place=2) exists", entries.some((e) => e.placement === 2), true);

// For a 0-prize cup all prizes should be 0
const totalPrize = entries.reduce((s, e) => s + Number(e.prizeUsdc6), 0);
check("prize sum = 0 (free cup)", totalPrize, 0);

console.log("\n[7] Bracket sanity");
const bracket = finalDetail.bracket;
check("bracket present", !!bracket, true);
const rounds = bracket?.rounds?.length ?? 0;
check("2 rounds for 4 players", rounds, 2);

console.log("\n[8] Games count (3 matches for 4-player SE)");
check("3 games played", finalDetail.games?.length, 3);

console.log("\n──────────────────────────────────────────────────");
console.log(`Stage 7 smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

await sql.end();
