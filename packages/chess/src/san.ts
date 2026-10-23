// Standard algebraic notation (SAN) for display, and the position after every ply.
// Moves travel as UCI on the wire and onchain; SAN is only for people.
import {
  START_FEN,
  parseFEN,
  toFEN,
  legalMoves,
  applyMove,
  inCheck,
  algebraicToSq,
  sqToAlgebraic,
  type Move,
  type Position,
} from "./engine.js";

const fileChar = (sq: number) => "abcdefgh"[sq & 7]!;
const rankChar = (sq: number) => String((sq >> 3) + 1);

/** Find the legal move a UCI string names, or null if it is not legal here. */
export function uciToMove(p: Position, uci: string): Move | null {
  const from = algebraicToSq(uci.slice(0, 2));
  const to = algebraicToSq(uci.slice(2, 4));
  const promo = uci[4] as Move["promo"] | undefined;
  return legalMoves(p).find((m) => m.from === from && m.to === to && m.promo === promo) ?? null;
}

/** SAN for a legal move in position p, including +/# suffixes. */
export function moveToSan(p: Position, m: Move): string {
  const piece = p.board[m.from]!;
  const kind = piece.toUpperCase();
  let san: string;

  if (kind === "K" && Math.abs((m.to & 7) - (m.from & 7)) === 2) {
    san = (m.to & 7) > (m.from & 7) ? "O-O" : "O-O-O";
  } else {
    const isCapture = p.board[m.to] !== "" || (kind === "P" && m.to === p.ep);
    if (kind === "P") {
      san = (isCapture ? `${fileChar(m.from)}x` : "") + sqToAlgebraic(m.to);
      if (m.promo) san += `=${m.promo.toUpperCase()}`;
    } else {
      // Disambiguate when another piece of the same kind can reach the same square.
      const rivals = legalMoves(p).filter(
        (o) => o.to === m.to && o.from !== m.from && p.board[o.from] === piece,
      );
      let from = "";
      if (rivals.length) {
        const sameFile = rivals.some((o) => (o.from & 7) === (m.from & 7));
        const sameRank = rivals.some((o) => o.from >> 3 === m.from >> 3);
        if (!sameFile) from = fileChar(m.from);
        else if (!sameRank) from = rankChar(m.from);
        else from = sqToAlgebraic(m.from);
      }
      san = kind + from + (isCapture ? "x" : "") + sqToAlgebraic(m.to);
    }
  }

  const next = applyMove(p, m);
  if (inCheck(next)) san += legalMoves(next).length === 0 ? "#" : "+";
  return san;
}

/**
 * SAN for a whole game given its UCI moves, plus the FEN before the first move
 * and after every ply (fens[0] is the start, fens[n] is after ply n).
 * Stops at the first move that is not legal, so a bad record never throws.
 */
export function sanLine(ucis: string[], startFen: string = START_FEN): { san: string[]; fens: string[] } {
  let p = parseFEN(startFen);
  const san: string[] = [];
  const fens: string[] = [toFEN(p)];
  for (const uci of ucis) {
    const m = uciToMove(p, uci);
    if (!m) break;
    san.push(moveToSan(p, m));
    p = applyMove(p, m);
    fens.push(toFEN(p));
  }
  return { san, fens };
}
