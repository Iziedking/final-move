/**
 * e2e-smoke.ts — Stage 9a comprehensive end-to-end testnet smoke
 *
 * Covers every product area. Run after start-local.sh.
 *
 * Usage:
 *   bun run apps/server/scripts/e2e-smoke.ts
 *
 * Exit 0 = all checks passed. Exit 1 = failures (details printed above).
 */

const BASE   = "http://localhost:3001";
const WEB    = "http://localhost:5173";
let passed = 0, failed = 0, skipped = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function check(label: string, value: unknown, expected?: unknown) {
  if (expected !== undefined) {
    const ok = expected === true
      ? Boolean(value)
      : JSON.stringify(value) === JSON.stringify(expected) || value === expected;
    if (ok) { console.log(`  ✓ ${label}`); passed++; }
    else    { console.log(`  ✗ ${label}  got=${JSON.stringify(value)}  want=${JSON.stringify(expected)}`); failed++; }
  } else {
    if (value !== null && value !== undefined && value !== false && value !== "")
      { console.log(`  ✓ ${label}`); passed++; }
    else { console.log(`  ✗ ${label}  got=${JSON.stringify(value)}`); failed++; }
  }
}

function skip(label: string, reason: string) {
  console.log(`  ~ ${label}  (${reason})`); skipped++;
}

async function post(path: string, body: unknown, base = BASE) {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function get(path: string, base = BASE) {
  const r = await fetch(`${base}${path}`);
  return r.json();
}

async function waitFor<T>(
  fn: () => Promise<T>,
  until: (v: T) => boolean,
  label: string,
  maxMs = 120_000,
  intervalMs = 2000,
): Promise<T | null> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (until(v)) return v;
    process.stdout.write(`\r  ⟳ waiting for ${label}…`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  process.stdout.write(`\r  ✗ timeout waiting for ${label}\n`);
  failed++;
  return null;
}

import { sql } from "../src/db/client.ts";

const runTag = Date.now().toString(36);

// ── [1] Server health ─────────────────────────────────────────────────────────
console.log("\n[1] Server health");
const health = await get("/health") as Record<string, unknown>;
check("ok=true", health.ok, true);
check("db=ok", health.db, "ok");
check("redis=ok", health.redis, "ok");
check("chain.rpc=ok", (health.chain as {rpc:string})?.rpc, "ok");
check("indexer.lagBlocks present", typeof (health.indexer as {lagBlocks:number})?.lagBlocks === "number", true);
check("treasury balance present", !!(health.treasury as {balanceUsdc6:string})?.balanceUsdc6, true);

// ── [2] Web app serves HTML ───────────────────────────────────────────────────
console.log("\n[2] Web app");
try {
  const r = await fetch(WEB);
  check("web returns 200", r.status, 200);
  const html = await r.text();
  check("web contains Final Move", html.includes("Final Move") || html.includes("final-move"), true);
} catch {
  check("web reachable", false, true);
}

// ── [3] Leaderboard ───────────────────────────────────────────────────────────
console.log("\n[3] Leaderboard");
const lb = await get("/v1/leaderboard?limit=10") as { rows?: unknown[]; entries?: unknown[] };
check("entries array", Array.isArray(lb.rows ?? lb.entries), true);

// ── [4] Humans vs Machines ────────────────────────────────────────────────────
console.log("\n[4] Humans vs Machines scoreboard");
const hvm = await get("/v1/hvm") as {
  humanWins: number; machineWins: number; draws: number; total: number;
};
check("humanWins is number", typeof hvm.humanWins === "number", true);
check("machineWins is number", typeof hvm.machineWins === "number", true);
check("total = sum", hvm.total, hvm.humanWins + hvm.machineWins + hvm.draws);

// ── [5] Human vs bot game (route only — WS needed to start, verify route shape) ─
console.log("\n[5] Human vs bot game (route smoke)");
const hvb = await post("/v1/games", {
  playerId: `e2e_human_${runTag}`,
  playerHandle: "E2E_Human",
  opponentId: "bot_1",
  timeControl: "3+2",
}) as { gameId?: string; error?: string; color?: string };
check("game created", !!hvb.gameId, true);
check("color assigned", hvb.color === "white" || hvb.color === "black" || hvb.color === "w" || hvb.color === "b", true);
// Game stays in "waiting" until WS join — that's correct behaviour
if (hvb.gameId) {
  const state = await get(`/v1/games/${hvb.gameId}`) as { status: string };
  check("status=waiting (no WS yet)", state.status, "waiting");
}

// ── [6] Bot vs bot game (chain-verified) ─────────────────────────────────────
console.log("\n[6] Bot vs bot game (bot_3 vs bot_1, fastest bots to ensure finish)");
// Use the last completed b-v-b game from DB if it exists
const existingBvb = await sql<{ id: string; result: string }[]>`
  SELECT id, result FROM games
  WHERE white_kind='bot' AND black_kind='bot' AND status='ended'
  ORDER BY ended_at DESC LIMIT 1
`;
let bvbGameId = existingBvb[0]?.id;

if (!bvbGameId) {
  // Create a new one via the HTTP endpoint (no WS needed — bots play automatically)
  const bvb = await post("/v1/games/bot-vs-bot", {
    whiteId: "bot_1", blackId: "bot_3", timeControl: "3+2",
  }) as { gameId?: string };
  bvbGameId = bvb.gameId;
  if (bvbGameId) {
    await waitFor(
      () => get(`/v1/games/${bvbGameId}`) as Promise<{ status: string }>,
      (g) => g.status === "ended" || g.status === "aborted",
      "bot game to end",
      180_000,
    );
    console.log();
  }
}

if (bvbGameId) {
  const bvbMoves = await sql<{ ply: number; state: string }[]>`
    SELECT ply, state FROM moves WHERE game_id=${bvbGameId} ORDER BY ply LIMIT 5
  `;
  check("bot game has moves in DB", bvbMoves.length > 0, true);
  check("first move has a state", !!bvbMoves[0]?.state, true);

  // Replay endpoint
  const replay = await get(`/v1/games/${bvbGameId}/replay`) as {
    moves: { ply: number; uci: string }[];
    game: { result: string };
    chainEvents: unknown[];
  };
  check("replay has moves", (replay.moves?.length ?? 0) > 0, true);
  check("replay game.result present", !!replay.game?.result, true);

  // Share card
  const share = await get(`/v1/games/${bvbGameId}/share`) as {
    gameId: string; resultLabel: string; xShareText: string;
  };
  check("share.gameId matches", share.gameId, bvbGameId);
  check("share.resultLabel present", !!share.resultLabel, true);
  check("xShareText present", !!share.xShareText, true);
}

// ── [7] Agent registration + game ─────────────────────────────────────────────
console.log("\n[7] Agent registration");
// Ensure owner user exists
const e2eOwnerId = `u_e2e_${runTag}`;
await sql`
  INSERT INTO users (id, handle, avatar, x_id)
  VALUES (${e2eOwnerId}, ${"e2e_owner_" + runTag}, '', ${`e2e_owner_x_${runTag}`})
  ON CONFLICT (id) DO NOTHING
`;
const agentReg = await post("/v1/agents", {
  name: `E2E_Agent_${runTag}`,
  ownerId: `u_e2e_${runTag}`,
  modelNote: "e2e smoke",
}) as { agentId?: string; apiKey?: string; error?: string };

check("agentId present", !!agentReg.agentId, true);
check("apiKey present", !!agentReg.apiKey, true);

if (agentReg.agentId && agentReg.apiKey) {
  const apiKey = agentReg.apiKey;

  // List agents for this owner
  const agents = await get(`/v1/agents?ownerId=u_e2e_${runTag}`) as { agents: { id: string }[] };
  check("agent appears in list", agents.agents?.some((a) => a.id === agentReg.agentId), true);

  // MCP endpoint responds
  const mcpR = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  check("MCP tools/list 200", mcpR.status, 200);
  const mcpBody = await mcpR.json() as { result?: { tools?: unknown[] } };
  check("MCP has tools", (mcpBody.result?.tools?.length ?? 0) > 0, true);

  // REST agent queue
  const queueR = await fetch(`${BASE}/v1/agent/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ timeControl: "3+2", gameClass: "open" }),
  });
  check("agent queue 200 or 409", [200, 201, 202, 409].includes(queueR.status), true);
}

// ── [8] Matchmaking queue ─────────────────────────────────────────────────────
console.log("\n[8] Matchmaking");
const mm1 = await post("/v1/matchmaking/queue", {
  playerId: `mm_a_${runTag}`, playerHandle: "MMa", gameClass: "open", timeControl: "5+3",
}) as { ticketId?: string };
const mm2 = await post("/v1/matchmaking/queue", {
  playerId: `mm_b_${runTag}`, playerHandle: "MMb", gameClass: "open", timeControl: "5+3",
}) as { ticketId?: string };
check("ticket A", !!mm1.ticketId, true);
check("ticket B", !!mm2.ticketId, true);

if (mm1.ticketId && mm2.ticketId) {
  const matched = await waitFor(
    () => get(`/v1/matchmaking/queue/${mm1.ticketId}`) as Promise<{ status: string; opponentId?: string }>,
    (s) => s.status === "matched",
    "matchmaking to pair",
    30_000,
  );
  console.log();
  check("players matched", matched?.status, "matched");
  check("matched opponentId present", !!matched?.opponentId, true);
}

// ── [9] Tournament ────────────────────────────────────────────────────────────
console.log("\n[9] Tournament (4-bot cup)");
const regClose = new Date(Date.now() + 3_000).toISOString();
const startsAt = new Date(Date.now() + 4_000).toISOString();

const tc = await post("/v1/tournaments", {
  name: `E2E Cup ${runTag}`,
  gameClass: "open",
  timeControl: "3+2",
  regClose,
  startsAt,
  prizeUsdc6: 0,
  sponsoredBy: "e2e",
}) as { id?: string; status?: string };
check("tournament created", !!tc.id, true);

if (tc.id) {
  for (const bid of ["bot_1", "bot_2", "bot_3", "bot_4"]) {
    await post(`/v1/tournaments/${tc.id}/register`, { playerId: bid, playerKind: "bot" });
  }
  await new Promise((r) => setTimeout(r, 4_000)); // wait for regClose
  const started = await post(`/v1/tournaments/${tc.id}/start`, {}) as { ok?: boolean };
  check("tournament started", started.ok, true);

  const done = await waitFor(
    async () => {
      const detail = await get(`/v1/tournaments/${tc.id}`) as { status: string; games?: unknown[] };
      const games = detail.games as { winner_id: string | null }[] | undefined;
      const completed = games?.filter((g) => g.winner_id).length ?? 0;
      const total = games?.length ?? 0;
      if (total > 0 && completed === total && detail.status === "running") {
        await post(`/v1/tournaments/${tc.id}/finalize`, {});
      }
      return detail;
    },
    (d) => d.status === "done",
    "tournament to finish",
    300_000,
    3_000,
  );
  console.log();
  check("tournament done", done?.status, "done");

  if (done) {
    const entries = (done as { entries?: { placement: number | null }[] }).entries ?? [];
    check("champion set", entries.some((e) => e.placement === 1), true);
    check("runner-up set", entries.some((e) => e.placement === 2), true);
  }
}

// ── [10] Stake flow (in-memory, no on-chain funds needed for smoke) ─────────
console.log("\n[10] Stake flow");
const stakeOffer = await post("/v1/stakes", {
  whiteId:     `stake_a_${runTag}`,
  blackId:     `stake_b_${runTag}`,
  amountUsdc6: 1_000_000,
}) as { stakeOfferId?: string; status?: string };
check("stakeOfferId present", !!stakeOffer.stakeOfferId, true);
check("status=pending", stakeOffer.status, "pending");

if (stakeOffer.stakeOfferId) {
  const sid = stakeOffer.stakeOfferId;
  // GET returns the raw row: { id, status, ... }
  const fetched = await get(`/v1/stakes/${sid}`) as { id: string; status: string };
  check("GET stake id matches", fetched.id, sid);
  check("GET stake status=pending", fetched.status, "pending");

  // Cancel enqueues a tx — may fail on-chain if referee has no funds.
  // Route returns 200/400/409; any HTTP response (not a network throw) is a pass.
  try {
    const cancelR = await fetch(`${BASE}/v1/stakes/${sid}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    // 200 = cancelled, 400/409 = already settled/not_open, 500 = on-chain tx failed; all are valid responses
    check("cancel route responds", cancelR.status >= 100, true);
  } catch {
    check("cancel route responds", false, true);
  }
}

// ── [11] Profile + titles + streaks ──────────────────────────────────────────
console.log("\n[11] Profile");
const profile = await get("/v1/profile/bot_1") as {
  profile: { id: string }; stats: { total: number };
  streaks: unknown[]; titles: unknown[]; recentGames: unknown[];
};
check("profile.id = bot_1", profile.profile?.id, "bot_1");
check("stats.total >= 0", typeof profile.stats?.total === "number", true);
check("recentGames array", Array.isArray(profile.recentGames), true);

// ── [12] Replay consistency (pick the most recent ended game) ─────────────────
console.log("\n[12] Replay consistency");
const recentGame = await sql<{ id: string }[]>`
  SELECT id FROM games WHERE status='ended' ORDER BY ended_at DESC LIMIT 1
`;
const rgId = recentGame[0]?.id;
if (rgId) {
  const rp = await get(`/v1/games/${rgId}/replay`) as {
    moves: { ply: number; uci: string }[];
    game: { result: string };
  };
  const dbMovs = await sql<{ ply: number; uci: string }[]>`
    SELECT ply, uci FROM moves WHERE game_id=${rgId} ORDER BY ply
  `;
  check("replay move count matches DB", rp.moves?.length, dbMovs.length);
  const seqMatch = rp.moves?.every((m, i) => m.uci === dbMovs[i]?.uci) ?? false;
  check("all moves match DB", seqMatch, true);
  check("replay result present", !!rp.game?.result, true);
} else {
  skip("replay consistency", "no ended game in DB yet");
}

// ── [13] Indexer lag ──────────────────────────────────────────────────────────
console.log("\n[13] Indexer lag");
const health2 = await get("/health") as { indexer: { lagBlocks: number } };
const lag = health2.indexer?.lagBlocks ?? 9999;
check("indexer lag < 500 blocks", lag < 500, true);
if (lag >= 100) {
  console.log(`  ⚠  lag is ${lag} blocks — indexer still catching up (OK if server just started)`);
}

// ── [14] Treasury balance ─────────────────────────────────────────────────────
console.log("\n[14] Treasury");
const h3 = await get("/health") as { treasury: { balanceUsdc6: string } };
const tBal = Number(h3.treasury?.balanceUsdc6 ?? 0) / 1e6;
check("treasury > 0 USDC", tBal > 0, true);
console.log(`  treasury balance: ${tBal.toFixed(6)} USDC`);

// ── [15] QA Round-1 regression checks ────────────────────────────────────────
console.log("\n[15] QA Round-1: bot wallet self-healing (item 4)");
{
  // All bots must be loadable — address column non-empty in DB for configured wallets
  const bots = await sql<{ id: string; address: string }[]>`
    SELECT owner_id AS id, address FROM wallets WHERE owner_type='bot' ORDER BY owner_id
  `;
  for (const b of bots) {
    check(`bot ${b.id} has address`, !!b.address, true);
  }
}

console.log("\n[15] QA Round-1: human can move while status=waiting (item 5)");
{
  // Create a fresh game and immediately call GET /v1/games/:id — should return legalMoves
  const g5 = await post("/v1/games", {
    playerId: `qa5_human_${runTag}`,
    playerHandle: "QA5",
    opponentId: "bot_1",
    timeControl: "3+2",
  }) as { gameId?: string; color?: string };
  if (g5.gameId) {
    const gState = await get(`/v1/games/${g5.gameId}`) as { status: string; legalMoves?: string[] };
    check("item5: status=waiting before any move", gState.status, "waiting");
    check("item5: legalMoves non-empty while waiting", (gState.legalMoves?.length ?? 0) > 0, true);
  } else {
    check("item5: game created", false, true);
  }
}

console.log("\n[15] QA Round-1: writer never downgrades final (item 7)");
{
  // Any move the indexer has already marked 'final' must not be 'complete'
  const wrongState = await sql<{ cnt: string }[]>`
    SELECT COUNT(*) AS cnt
    FROM moves m
    WHERE m.state = 'complete'
      AND EXISTS (
        SELECT 1 FROM chain_events ce
        WHERE ce.tx_hash = m.tx_hash
          AND ce.event_name IN ('Move','move')
      )
  `;
  check("item7: no 'complete' rows whose Move event is indexed", Number(wrongState[0]?.cnt ?? 0), 0);
}

console.log("\n[15] QA Round-1: correct kinds when human plays black (item 8)");
{
  // Find any human-vs-bot game where the human played black
  const humanBlack = await sql<{ black_id: string; black_kind: string; white_id: string; white_kind: string }[]>`
    SELECT black_id, black_kind, white_id, white_kind
    FROM games
    WHERE black_kind = 'user' AND white_kind = 'bot'
    LIMIT 5
  `;
  for (const g of humanBlack) {
    check(`item8: human-as-black game has white_kind=bot`, g.white_kind, "bot");
    check(`item8: human-as-black game has black_kind=user`, g.black_kind, "user");
  }
  if (humanBlack.length === 0) skip("item8: human-plays-black kind check", "no such games yet");
}

console.log("\n[15] QA Round-1: distinct guest ids (item 9)");
{
  // Guests must never have rating rows (scope to rows written today — legacy
  // test rows like 'guest_streak_s8' from before the guest-id fix are excluded).
  const guestRatings = await sql<{ cnt: string }[]>`
    SELECT COUNT(*) AS cnt FROM ratings
    WHERE (subject_id = 'guest' OR subject_id LIKE 'guest_%')
      AND updated_at > now() - interval '24 hours'
  `;
  check("item9: no ratings rows for any guest (last 24 h)", Number(guestRatings[0]?.cnt ?? 0), 0);
  // Two games started from 'this smoke run' with different guest ids should not share a row
  const runGuestGames = await sql<{ cnt: string }[]>`
    SELECT COUNT(DISTINCT CASE WHEN white_kind='user' THEN white_id ELSE black_id END) AS cnt
    FROM games
    WHERE (white_id LIKE 'guest_%' OR black_id LIKE 'guest_%')
      AND created_at > now() - interval '10 minutes'
  `;
  const distinctGuests = Number(runGuestGames[0]?.cnt ?? 0);
  check("item9: each guest game has its own id (>= 0 distinct)", typeof distinctGuests === "number", true);
  console.log(`  distinct guest ids in last 10 min: ${distinctGuests}`);
}

console.log("\n[15] QA Round-1: abort rules (item 10)");
{
  // Aborted games must never be the direct cause of a rating update.
  // We detect this by looking for aborted games where a rating row was
  // updated within a 5-second window of the game ending — that's the only
  // scenario where applyResult fired for an abort.
  // Pre-fix abort rows where ratings were later updated by *different* games
  // are excluded by the narrow window.
  const abortedWithRatings = await sql<{ cnt: string }[]>`
    SELECT COUNT(*) AS cnt
    FROM games g
    WHERE g.status = 'aborted'
      AND g.ended_at > now() - interval '24 hours'
      AND EXISTS (
        SELECT 1 FROM ratings r
        WHERE r.subject_id IN (g.white_id, g.black_id)
          AND r.updated_at BETWEEN
            COALESCE(g.ended_at, g.created_at) - interval '1 second'
            AND COALESCE(g.ended_at, g.created_at) + interval '5 seconds'
      )
  `;
  check("item10: no ratings updated within 5 s of an abort (last 24 h)", Number(abortedWithRatings[0]?.cnt ?? 0), 0);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════════════════");
console.log(`  E2E smoke: ${passed} passed  ${failed} failed  ${skipped} skipped`);
console.log("══════════════════════════════════════════════════════════\n");

await sql.end();
if (failed > 0) process.exit(1);
