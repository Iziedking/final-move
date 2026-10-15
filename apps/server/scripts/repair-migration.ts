/**
 * repair-migration.ts — Testnet QA Round 1 data repair
 *
 * Runs the 007_qa_round1_repair migration and logs what it changed.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   bun run apps/server/scripts/repair-migration.ts
 */
import { sql } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";

console.log("=== Testnet QA Round 1 — Repair Migration ===\n");

// ── Snapshot counts before ─────────────────────────────────────────────────────

const beforeRatings = await sql<{ kind: string; cnt: string }[]>`
  SELECT subject_kind AS kind, COUNT(*) AS cnt
  FROM ratings
  GROUP BY subject_kind
  ORDER BY subject_kind
`;
const beforeCompleteMoves = await sql<{ cnt: string }[]>`
  SELECT COUNT(*) AS cnt FROM moves WHERE state = 'complete'
`;
const beforeFinalMoves = await sql<{ cnt: string }[]>`
  SELECT COUNT(*) AS cnt FROM moves WHERE state = 'final'
`;
const beforeHvm = await sql<{ human_wins: number; machine_wins: number; draws: number }[]>`
  SELECT human_wins, machine_wins, draws FROM hvm_scoreboard WHERE id = 1
`;

console.log("BEFORE:");
console.log("  ratings by kind:", beforeRatings.map((r) => `${r.kind}=${r.cnt}`).join(", "));
console.log("  moves at state='complete':", beforeCompleteMoves[0]?.cnt ?? 0);
console.log("  moves at state='final'  :", beforeFinalMoves[0]?.cnt ?? 0);
if (beforeHvm[0]) {
  const h = beforeHvm[0];
  console.log(`  hvm_scoreboard: human_wins=${h.human_wins}  machine_wins=${h.machine_wins}  draws=${h.draws}`);
} else {
  console.log("  hvm_scoreboard: (no row)");
}

// ── Run the migration ──────────────────────────────────────────────────────────

console.log("\nRunning migrations…");
await runMigrations();

// ── Snapshot counts after ──────────────────────────────────────────────────────

const afterRatings = await sql<{ kind: string; cnt: string }[]>`
  SELECT subject_kind AS kind, COUNT(*) AS cnt
  FROM ratings
  GROUP BY subject_kind
  ORDER BY subject_kind
`;
const afterCompleteMoves = await sql<{ cnt: string }[]>`
  SELECT COUNT(*) AS cnt FROM moves WHERE state = 'complete'
`;
const afterFinalMoves = await sql<{ cnt: string }[]>`
  SELECT COUNT(*) AS cnt FROM moves WHERE state = 'final'
`;
const afterHvm = await sql<{ human_wins: number; machine_wins: number; draws: number }[]>`
  SELECT human_wins, machine_wins, draws FROM hvm_scoreboard WHERE id = 1
`;

console.log("\nAFTER:");
console.log("  ratings by kind:", afterRatings.map((r) => `${r.kind}=${r.cnt}`).join(", "));
console.log("  moves at state='complete':", afterCompleteMoves[0]?.cnt ?? 0);
console.log("  moves at state='final'  :", afterFinalMoves[0]?.cnt ?? 0);
if (afterHvm[0]) {
  const h = afterHvm[0];
  console.log(`  hvm_scoreboard: human_wins=${h.human_wins}  machine_wins=${h.machine_wins}  draws=${h.draws}`);
} else {
  console.log("  hvm_scoreboard: (no row)");
}

// ── Delta summary ──────────────────────────────────────────────────────────────

const beforeCompleteN = Number(beforeCompleteMoves[0]?.cnt ?? 0);
const afterCompleteN  = Number(afterCompleteMoves[0]?.cnt ?? 0);
const beforeFinalN    = Number(beforeFinalMoves[0]?.cnt ?? 0);
const afterFinalN     = Number(afterFinalMoves[0]?.cnt ?? 0);

console.log("\nDELTA:");
console.log(`  moves promoted complete→final : ${afterFinalN - beforeFinalN}`);
console.log(`  moves still at 'complete'     : ${afterCompleteN}`);
if (beforeCompleteN === afterCompleteN && beforeCompleteN > 0) {
  console.log("  ⚠  no moves were promoted — Move events may not yet be indexed for those txs");
}

const ratingsBefore = new Map(beforeRatings.map((r) => [r.kind, Number(r.cnt)]));
const ratingsAfter  = new Map(afterRatings.map((r) => [r.kind, Number(r.cnt)]));
const kindsChanged = [...new Set([...ratingsBefore.keys(), ...ratingsAfter.keys()])].filter(
  (k) => (ratingsBefore.get(k) ?? 0) !== (ratingsAfter.get(k) ?? 0),
);
if (kindsChanged.length > 0) {
  console.log("  ratings kind changes:", kindsChanged.map(
    (k) => `${k}: ${ratingsBefore.get(k) ?? 0} → ${ratingsAfter.get(k) ?? 0}`,
  ).join(", "));
} else {
  console.log("  ratings kind distribution: unchanged");
}

console.log("\n✓ Repair migration complete.");
await sql.end();
