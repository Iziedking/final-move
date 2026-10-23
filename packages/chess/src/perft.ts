import {
  parseFEN,
  legalMoves,
  applyMove,
  outcome,
  repetitionKey,
  capturedValue,
  START_FEN,
  type Position,
} from "./engine.js";
import { bestCandidates } from "./search.js";
import { sanLine } from "./san.js";
import { buildBracket, nextMatch, recordResult, champion, placements, isComplete } from "./bracket.js";

// Perft: count leaf nodes of the legal-move tree to a depth. Matching the known
// reference counts proves the move generator (incl. castling, en passant, promotion,
// and check evasion) is correct. Run: npx tsx src/scripts/chessPerft.ts

function perft(p: Position, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of legalMoves(p)) n += perft(applyMove(p, m), depth - 1);
  return n;
}

let failures = 0;
function check(name: string, got: number, want: number) {
  const ok = got === want;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}: ${got}${ok ? "" : ` (want ${want})`}`);
  if (!ok) failures++;
}

// Starting position — the canonical perft numbers.
const start = parseFEN(START_FEN);
check("start d1", perft(start, 1), 20);
check("start d2", perft(start, 2), 400);
check("start d3", perft(start, 3), 8902);
check("start d4", perft(start, 4), 197281);

// "Kiwipete": dense with castling, en passant, pins, and promotions — the standard
// stress test for a move generator.
const kiwi = parseFEN("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
check("kiwipete d1", perft(kiwi, 1), 48);
check("kiwipete d2", perft(kiwi, 2), 2039);
check("kiwipete d3", perft(kiwi, 3), 97862);

// A promotion-heavy endgame position.
const promo = parseFEN("n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1");
check("promotions d1", perft(promo, 1), 24);
check("promotions d2", perft(promo, 2), 496);

// --- search / brain tactics: the engine must find the obvious best move ---
function checkStr(name: string, got: string, want: string) {
  const ok = got === want;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}: ${got}${ok ? "" : ` (want ${want})`}`);
  if (!ok) failures++;
}

// Back-rank mate in one: Ra1-a8# (king boxed in by its own pawns).
const mate = parseFEN("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1");
const mateBest = bestCandidates(mate, 2, 4)[0]!;
checkStr("finds mate in 1", mateBest.uci, "a1a8");
check("mate scores as winning", mateBest.score > 100000 ? 1 : 0, 1);

// A free queen hangs: Rd2xd5 wins it outright.
const hang = parseFEN("4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1");
const hangBest = bestCandidates(hang, 2, 4)[0]!;
checkStr("takes the hanging queen", hangBest.uci, "d2d5");

// Self-play smoke test: two engine players (depth 2) play a full game, the same loop the
// runner drives. It must terminate with a real result (or hit the ply cap) — no infinite
// game — and the captured-material score must stay within range.
let g: Position = parseFEN(START_FEN);
const seen = new Map<string, number>();
let plies = 0;
for (; plies < 300; plies++) {
  const rk = repetitionKey(g);
  const rep = (seen.get(rk) ?? 0) + 1;
  seen.set(rk, rep);
  if (outcome(g, rep).over) break;
  g = applyMove(g, bestCandidates(g, 2, 1)[0]!.move);
}
const finalOc = outcome(g, seen.get(repetitionKey(g)) ?? 1);
const caps = capturedValue(g);
check("self-play terminates", finalOc.over || plies >= 300 ? 1 : 0, 1);
check("captured material in range", caps.w <= 39 && caps.b <= 39 && caps.w >= 0 && caps.b >= 0 ? 1 : 0, 1);
console.log(`  self-play: ${plies} ply, result=${finalOc.over ? finalOc.result : "ply-cap"}, captured w:${caps.w} b:${caps.b}`);

// --- tournament bracket: seed 8, play it out (stronger seed wins), check placements ---
const field = Array.from({ length: 8 }, (_, i) => ({ agentId: i + 1, tier: 100 - (i + 1) }));
let br = buildBracket(field);
let played = 0;
let bm = nextMatch(br);
while (bm) {
  // Lower agentId is the stronger seed here (tier = 100 - id), so it wins.
  recordResult(br, bm.round, bm.index, bm.a! < bm.b! ? bm.a! : bm.b!);
  played += 1;
  bm = nextMatch(br);
}
check("bracket plays 7 matches", played, 7);
check("champion is the top seed", champion(br) ?? 0, 1);
check("bracket completes", isComplete(br) ? 1 : 0, 1);
const pl = placements(br);
check("runner-up is 2nd seed", pl.find((p) => p.place === 2)?.agentId ?? 0, 2);
check("semifinal losers share 3rd", pl.filter((p) => p.place === 3).length, 2);
check("quarterfinal losers share 5th", pl.filter((p) => p.place === 5).length, 4);

// SAN: captures, castling, mate, disambiguation, en passant, promotion.
{
  const ruy = sanLine(["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5c6", "d7c6", "e1g1"]);
  checkStr("san: Ruy Lopez exchange with castling", ruy.san.join(" "), "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O");
  checkStr("san: fool's mate", sanLine(["f2f3", "e7e5", "g2g4", "d8h4"]).san.join(" "), "f3 e5 g4 Qh4#");
  checkStr("san: knight file disambiguation", sanLine(["b1d2"], "4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1").san[0] ?? "", "Nbd2");
  checkStr("san: rook rank disambiguation", sanLine(["a1a4"], "4k3/8/8/R7/8/8/8/R3K3 w - - 0 1").san[0] ?? "", "R1a4");
  checkStr("san: en passant", sanLine(["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"]).san.slice(-1)[0] ?? "", "exd6");
  checkStr("san: promotion with check", sanLine(["a7a8q"], "7k/P7/8/8/8/8/8/4K3 w - - 0 1").san[0] ?? "", "a8=Q+");
  check("san: fens track every ply", ruy.fens.length, 10);
  checkStr("san: stops at an illegal move", sanLine(["e2e4", "e2e4"]).san.join(" "), "e4");
}

console.log(failures === 0 ? "\nall chess checks passed — engine, brain, games, and bracket" : `\n${failures} chess checks FAILED`);
(globalThis as { process?: { exit(code: number): never } }).process?.exit(failures === 0 ? 0 : 1);
