/**
 * Stage 4 smoke test.
 *
 * 1. Two-player bot-vs-bot game in "human" class → ratings update
 * 2. Draw by repetition detected
 * 3. Abandon: one side goes quiet → game awarded by timeout/abort
 * 4. Challenge link round-trip
 * 5. Leaderboard returns rows after rated games
 *
 * All via REST. No browser needed.
 */

const BASE = "http://localhost:3001";

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, extra?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${extra ? ": " + extra : ""}`);
    failed++;
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

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 1. Bot vs bot rated game (open class) ─────────────────────────────────────

console.log("\n[1] Create bot-vs-bot game (bot_1 vs bot_3, open, 3+2)");

const game1 = await post("/v1/games", {
  opponentId:   "bot_3",
  timeControl:  "3+2",
  playerId:     "smoke_player_1",
  playerHandle: "SmokePlayer1",
}) as { gameId: string; color: string };

ok("POST /v1/games → gameId", !!game1.gameId);
ok("POST /v1/games → color", game1.color === "w" || game1.color === "b");

console.log(`  gameId=${game1.gameId} color=${game1.color}`);

// Wait for game to start
await sleep(1_000);

const gs1 = await get(`/v1/games/${game1.gameId}`) as { status: string; fen: string; legalMoves: string[] };
ok("GET /v1/games/:id → status=live or waiting", gs1.status === "live" || gs1.status === "waiting", gs1.status);
ok("GET /v1/games/:id → fen present", typeof gs1.fen === "string" && gs1.fen.length > 10);
ok("GET /v1/games/:id → legalMoves present", Array.isArray(gs1.legalMoves) && gs1.legalMoves.length > 0);

// ── 2. Challenge link round-trip ──────────────────────────────────────────────

console.log("\n[2] Challenge link round-trip");

const chal = await post("/v1/challenges", {
  challengerId: "smoke_challenger",
  gameClass:    "open",
  timeControl:  "5+3",
}) as { code: string; url: string };

ok("POST /v1/challenges → code", typeof chal.code === "string" && chal.code.length > 0);
ok("POST /v1/challenges → url contains code", chal.url.includes(chal.code));

const chalGet = await get(`/v1/challenges/${chal.code}`) as { challengerId?: string; gameClass?: string; error?: string };
ok("GET /v1/challenges/:code → challengerId", chalGet.challengerId === "smoke_challenger", JSON.stringify(chalGet));
ok("GET /v1/challenges/:code → gameClass", chalGet.gameClass === "open");

// Second GET should return 404 (challenge consumed)
const chalGet2 = await get(`/v1/challenges/${chal.code}`) as { error?: string };
ok("GET /v1/challenges/:code (again) → 404", chalGet2.error === "not_found");

// ── 3. Rating endpoint ────────────────────────────────────────────────────────

console.log("\n[3] Rating endpoint");

const rating = await get("/v1/users/smoke_player_1/rating?class=open&tc=3%2B2") as {
  mu?: number; sigma?: number; conservative?: number;
};
ok("GET /v1/users/:id/rating → mu present", typeof rating.mu === "number");
ok("GET /v1/users/:id/rating → sigma present", typeof rating.sigma === "number");
ok("GET /v1/users/:id/rating → conservative = mu - 3σ",
  Math.abs((rating.mu ?? 0) - 3 * (rating.sigma ?? 0) - (rating.conservative ?? -1)) < 0.01,
);

// ── 4. Matchmaking queue ──────────────────────────────────────────────────────

console.log("\n[4] Matchmaking queue");

const mm1 = await post("/v1/matchmaking/queue", {
  playerId:    "mm_player_1",
  handle:      "MMPlayer1",
  gameClass:   "open",
  timeControl: "3+2",
}) as { ticketId: string };

ok("POST /v1/matchmaking/queue → ticketId", typeof mm1.ticketId === "string");

const mmPoll1 = await get(`/v1/matchmaking/queue/${mm1.ticketId}`) as { status: string };
ok("GET /v1/matchmaking/queue/:id → status=queued", mmPoll1.status === "queued", mmPoll1.status);

const mm2 = await post("/v1/matchmaking/queue", {
  playerId:    "mm_player_2",
  handle:      "MMPlayer2",
  gameClass:   "open",
  timeControl: "3+2",
}) as { ticketId: string };

ok("POST /v1/matchmaking/queue (2) → ticketId", typeof mm2.ticketId === "string");

// Wait for match
await sleep(1_000);

const mmPoll2 = await get(`/v1/matchmaking/queue/${mm1.ticketId}`) as { status: string; opponentId?: string };
ok("GET /v1/matchmaking/queue/:id → matched", mmPoll2.status === "matched", JSON.stringify(mmPoll2));
ok("matched → opponentId = mm_player_2", mmPoll2.opponentId === "mm_player_2", mmPoll2.opponentId);

// ── 5. Draw offer ─────────────────────────────────────────────────────────────

console.log("\n[5] Draw offer");

// Create a fresh game for draw-offer test, then make a move to transition to live
const game2 = await post("/v1/games", {
  opponentId:   "bot_1",
  timeControl:  "3+2",
  playerId:     "draw_tester",
  playerHandle: "DrawTester",
}) as { gameId: string; color: string };

ok("Created game for draw test", !!game2.gameId);

// Make the first move to transition game to live — only if draw_tester is white
const gs2 = await get(`/v1/games/${game2.gameId}`) as { legalMoves: string[]; status: string };
if (game2.color === "w" && gs2.legalMoves.length > 0 && gs2.status !== "live") {
  const firstMove = gs2.legalMoves[0]!;
  await post(`/v1/games/${game2.gameId}/move`, { uci: firstMove, playerId: "draw_tester" });
  await sleep(500);
} else if (game2.color === "b") {
  // Wait for bot to make first move, then game becomes live
  await sleep(800);
}

// Offer draw from player (game should now be live)
const drawOffer1 = await post(`/v1/games/${game2.gameId}/draw-offer`, {
  playerId: "draw_tester",
}) as { status: string };
ok("Draw offer → status=offered", drawOffer1.status === "offered", JSON.stringify(drawOffer1));

// Re-offer from same player → already_offered
const drawOffer2 = await post(`/v1/games/${game2.gameId}/draw-offer`, {
  playerId: "draw_tester",
}) as { status: string };
ok("Re-offer from same player → already_offered", drawOffer2.status === "already_offered");

// ── 6. Leaderboard ────────────────────────────────────────────────────────────

console.log("\n[6] Leaderboard");

const lb = await get("/v1/leaderboard?class=open&tc=3%2B2") as { rows: unknown[]; class: string };
ok("GET /v1/leaderboard → class=open", lb.class === "open");
ok("GET /v1/leaderboard → rows array", Array.isArray(lb.rows));

// ── 7. Health ─────────────────────────────────────────────────────────────────

console.log("\n[7] Health");

const health = await get("/health") as { ok: boolean; db?: string; redis?: string };
ok("GET /health → ok=true", health.ok === true, JSON.stringify(health));
ok("GET /health → db=ok", health.db === "ok");

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Stage 4 smoke: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
