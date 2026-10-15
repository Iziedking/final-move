/**
 * Stage 8 smoke test — Replay, Profile, HvM, Share card
 * "Done when": any finished game's replay matches its server record move for
 *   move, and its share card renders and posts.
 */

const BASE = "http://localhost:3001";
let passed = 0, failed = 0;

function check(label: string, value: unknown, expected?: unknown) {
  if (expected !== undefined) {
    const ok = JSON.stringify(value) === JSON.stringify(expected) ||
               (typeof expected === "boolean" ? Boolean(value) === expected : value === expected);
    if (ok) { console.log(`  ✓ ${label}`); passed++; }
    else    { console.log(`  ✗ ${label}  got=${JSON.stringify(value)}`); failed++; }
  } else {
    if (value !== null && value !== undefined && value !== false && value !== "")
      { console.log(`  ✓ ${label}`); passed++; }
    else { console.log(`  ✗ ${label}  got=${JSON.stringify(value)}`); failed++; }
  }
}

async function post(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json();
}
async function get(path: string) {
  return fetch(`${BASE}${path}`).then((r) => r.json());
}

import { sql } from "../src/db/client.ts";

// ── [0] Ensure we have at least one finished game ─────────────────────────────
console.log("\n[0] Find a finished game");
const gameRows = await sql<{ id: string; white_id: string; black_id: string; result: string }[]>`
  SELECT id, white_id, black_id, result FROM games
  WHERE status='ended' AND result IS NOT NULL
  ORDER BY ended_at DESC LIMIT 1
`;
let gameId = gameRows[0]?.id ?? null;

if (!gameId) {
  // Create a quick bot game to finish
  console.log("  No finished game found, creating one...");
  const g = await post("/v1/games", { playerId: "guest_s8", playerHandle: "Guest_s8", opponentId: "bot_1", timeControl: "3+2" });
  gameId = g.gameId;
  // Wait a bit for the game to reach ended state
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const state = await get(`/v1/games/${gameId}`);
    if (state.status === "ended") break;
  }
  const final = await get(`/v1/games/${gameId}`);
  check("game ended for smoke", final.status, "ended");
} else {
  console.log(`  using game ${gameId}`);
  check("game found", gameId);
}

// ── [1] Replay endpoint ────────────────────────────────────────────────────────
console.log("\n[1] Replay endpoint");
const replay = await get(`/v1/games/${gameId}/replay`) as {
  game: { id: string; result: string | null; whiteName: string; blackName: string };
  moves: { ply: number; uci: string; state: string }[];
  chainEvents: unknown[];
};
check("game object", replay.game?.id, gameId);
check("moves array present", Array.isArray(replay.moves), true);
check("chainEvents array present", Array.isArray(replay.chainEvents), true);

// Verify moves match DB
const dbMoves = await sql<{ ply: number; uci: string }[]>`
  SELECT ply, uci FROM moves WHERE game_id=${gameId} ORDER BY ply
`;
check("replay move count matches DB", replay.moves.length, dbMoves.length);
let allMatch = true;
for (let i = 0; i < Math.min(replay.moves.length, dbMoves.length); i++) {
  if (replay.moves[i]!.ply !== dbMoves[i]!.ply || replay.moves[i]!.uci !== dbMoves[i]!.uci) {
    allMatch = false; break;
  }
}
check("every move UCI matches DB", allMatch, true);
check("result present", replay.game.result);

// ── [2] Replay 404 on unknown game ────────────────────────────────────────────
console.log("\n[2] Replay 404");
const notFound = await fetch(`${BASE}/v1/games/g_notexist/replay`);
check("404 on unknown game", notFound.status, 404);

// ── [3] Share card endpoint ────────────────────────────────────────────────────
console.log("\n[3] Share card");
const share = await get(`/v1/games/${gameId}/share`) as {
  gameId: string; whiteName: string; blackName: string; resultLabel: string;
  moveCount: number; xShareText: string;
};
check("share gameId matches", share.gameId, gameId);
check("whiteName present", share.whiteName);
check("blackName present", share.blackName);
check("resultLabel present", share.resultLabel);
check("moveCount > 0", (share.moveCount ?? 0) > 0, true);
check("xShareText contains gameId", share.xShareText?.includes(gameId!) ?? false, true);

// ── [4] HvM scoreboard ─────────────────────────────────────────────────────────
console.log("\n[4] HvM scoreboard");
const hvm = await get("/v1/hvm") as {
  humanWins: number; machineWins: number; draws: number; total: number;
  humanPct: number; machinePct: number;
};
check("humanWins is number", typeof hvm.humanWins === "number", true);
check("machineWins is number", typeof hvm.machineWins === "number", true);
check("draws is number", typeof hvm.draws === "number", true);
check("total = sum", hvm.total, hvm.humanWins + hvm.machineWins + hvm.draws);
check("pct sum ≤ 100", hvm.humanPct + hvm.machinePct <= 100, true);

// ── [5] Profile endpoint ───────────────────────────────────────────────────────
console.log("\n[5] Profile endpoint");
const whiteId = gameRows[0]?.white_id ?? "bot_1";
const profile = await get(`/v1/profile/${whiteId}`) as {
  profile: { id: string; kind: string; name: string };
  stats: { wins: number; draws: number; losses: number; total: number };
  ratings: unknown[]; streaks: unknown[]; titles: unknown[]; recentGames: unknown[];
};
check("profile id matches", profile.profile?.id, whiteId);
check("stats present", typeof profile.stats?.total === "number", true);
check("stats total = wins+draws+losses", profile.stats.total, profile.stats.wins + profile.stats.draws + profile.stats.losses);
check("recentGames array", Array.isArray(profile.recentGames), true);

// ── [6] Profile 404 on nonsense id ────────────────────────────────────────────
console.log("\n[6] Profile 404");
const p404 = await fetch(`${BASE}/v1/profile/nonsense_id_xyz`);
check("404 on unknown non-bot player", p404.status, 404);

// ── [7] Replay matches server record move for move ────────────────────────────
console.log("\n[7] Replay consistency");
const moveSeq = replay.moves.map((m: { uci: string }) => m.uci).join(",");
const dbSeq   = dbMoves.map((m) => m.uci).join(",");
check("move sequence identical", moveSeq === dbSeq, true);

// ── [8] Streak populated via a new game ───────────────────────────────────────
console.log("\n[8] Streaks populated by new game");
// Play a fresh game to trigger streak update
const ng = await post("/v1/games", { playerId: "guest_streak_s8", playerHandle: "Guest_sk8", opponentId: "bot_1", timeControl: "3+2" }) as { gameId: string };
check("new game created", !!ng.gameId, true);
if (ng.gameId) {
  // Wait for it to end
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await get(`/v1/games/${ng.gameId}`) as { status: string };
    if (s.status === "ended" || s.status === "aborted") break;
  }
  await new Promise((r) => setTimeout(r, 1000)); // let async streak update run
  const streakRows = await sql<{ subject_id: string; current_streak: number }[]>`
    SELECT subject_id, current_streak FROM streaks LIMIT 5
  `;
  check("streak rows exist after new game", streakRows.length > 0, true);
} else {
  check("streak rows exist after new game", false, true);
}

console.log("\n──────────────────────────────────────────────────");
console.log(`Stage 8 smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

await sql.end();
