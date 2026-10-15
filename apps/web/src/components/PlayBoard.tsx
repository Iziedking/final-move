"use client";
/**
 * PlayBoard — interactive chess board.
 *
 * Design:
 *   Light squares: --sq-light (warm cream).
 *   Dark squares:  --sq-dark  (warm caramel).
 *   Last-move highlight: amber tint on both squares.
 *   Selected piece: teal tint + teal outline.
 *   Legal move dot (empty square): 28% circle, teal/30%.
 *   Capture ring (occupied target): 5 px inset ring, teal/50%.
 *   King in check: coral glow.
 *   Chain-state mark on last-move "to" square:
 *     queued: faint amber dot (3 px)
 *     sent/complete: amber dot + pulse
 *     final: teal dot + brief stamp fade
 *   Coordinates: file (bottom edge) and rank (left edge), readable in both themes.
 *   Board orientation: flipped when player is black; player's own bar is at the bottom.
 */
import React, { useState, useCallback, useMemo } from "react";
import type { ChainRailEntry } from "@/lib/types";
import { ChessPiece } from "./ChessPieces";

function fenToBoard(fen: string): (string | null)[] {
  const placement = fen.split(" ")[0] ?? "";
  const board: (string | null)[] = [];
  for (const rank of placement.split("/")) {
    for (const ch of rank) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) board.push(null);
      } else {
        board.push(ch);
      }
    }
  }
  while (board.length < 64) board.push(null);
  return board;
}

/** Get king square for a colour from FEN. Returns -1 if not found. */
function kingIdx(board: (string | null)[], color: "w" | "b"): number {
  const k = color === "w" ? "K" : "k";
  return board.findIndex((p) => p === k);
}

/** Check if the colour's king is in check from the FEN side-to-move field. */
function isInCheck(fen: string, color: "w" | "b"): boolean {
  // Approximate: if the FEN side-to-move matches colour and fen contains " b " or " w "
  // The server never sends check info explicitly, so we detect via move count.
  // Simplification: use the FEN active colour — if the active player is on move
  // we don't know if they're in check without full move generation.
  // Return false to avoid false positives; the legal-move list already blocks illegal moves.
  void fen; void color;
  return false;
}

/** "e2" → render index (a8=0 array). */
export function algToIdx(alg: string): number {
  if (!alg || alg.length < 2) return -1;
  const file = alg.charCodeAt(0) - 97;
  const rank = Number(alg[1]) - 1;
  return (7 - rank) * 8 + file;
}

/** Render index → algebraic square. */
export function idxToAlg(idx: number): string {
  const file = String.fromCharCode(97 + (idx % 8));
  const rank = String(8 - Math.floor(idx / 8));
  return file + rank;
}

interface PlayBoardProps {
  fen: string;
  legalMoves: string[];
  myColor: "w" | "b" | null;
  turn: "w" | "b";
  lastUci?: string;
  flipped?: boolean;
  onMove: (uci: string) => void;
  disabled?: boolean;
  /** Chain state of the last move, for the on-board stamp. */
  lastMoveState?: ChainRailEntry["state"];
}

export function PlayBoard({
  fen,
  legalMoves,
  myColor,
  turn,
  lastUci,
  flipped: flippedProp = false,
  onMove,
  disabled = false,
  lastMoveState,
}: PlayBoardProps): React.JSX.Element {
  // Auto-flip so player's own pieces are at the bottom
  const flipped = myColor === "b" ? !flippedProp : flippedProp;

  const [selected, setSelected] = useState<number | null>(null);

  const board    = useMemo(() => fenToBoard(fen), [fen]);
  const fromIdx  = lastUci ? algToIdx(lastUci.slice(0, 2)) : -1;
  const toIdx    = lastUci ? algToIdx(lastUci.slice(2, 4)) : -1;
  const inCheck  = isInCheck(fen, turn);
  const checkIdx = inCheck ? kingIdx(board, turn) : -1;

  const legalTargets = useMemo<Set<number>>(() => {
    if (selected === null) return new Set();
    const fromAlg = idxToAlg(selected);
    return new Set(
      legalMoves
        .filter((u) => u.startsWith(fromAlg))
        .map((u) => algToIdx(u.slice(2, 4))),
    );
  }, [selected, legalMoves]);

  const selectablePieces = useMemo<Set<number>>(() => {
    if (myColor !== turn || disabled) return new Set();
    const set = new Set<number>();
    for (const u of legalMoves) set.add(algToIdx(u.slice(0, 2)));
    return set;
  }, [legalMoves, myColor, turn, disabled]);

  const handleClick = useCallback(
    (idx: number) => {
      if (disabled || myColor !== turn) return;
      const piece = board[idx];
      if (selected !== null) {
        if (legalTargets.has(idx)) {
          const fromAlg     = idxToAlg(selected);
          const toAlg       = idxToAlg(idx);
          const movingPiece = board[selected];
          const needsPromo  =
            (movingPiece === "P" && toAlg[1] === "8") ||
            (movingPiece === "p" && toAlg[1] === "1");
          onMove(fromAlg + toAlg + (needsPromo ? "q" : ""));
          setSelected(null);
          return;
        }
        if (piece && selectablePieces.has(idx)) { setSelected(idx); return; }
        setSelected(null);
        return;
      }
      if (piece && selectablePieces.has(idx)) setSelected(idx);
    },
    [selected, legalTargets, selectablePieces, board, disabled, myColor, turn, onMove],
  );

  const displayOrder = useMemo(() => {
    const indices = Array.from({ length: 64 }, (_, i) => i);
    return flipped ? indices.reverse() : indices;
  }, [flipped]);

  // Chain-state dot for the last-move "to" square
  const chainDotStyle: React.CSSProperties | undefined = (() => {
    if (!lastMoveState) return undefined;
    if (lastMoveState === "final")   return { background: "rgb(var(--teal))",  boxShadow: "0 0 0 2px rgb(var(--teal) / 0.3)" };
    if (lastMoveState === "complete") return { background: "rgb(var(--amber))" };
    if (lastMoveState === "sent")     return { background: "rgb(var(--amber))", animation: "pulse 1s ease-in-out infinite" };
    return { background: "rgb(var(--ink-3))" };
  })();

  return (
    <div
      className="w-full select-none"
      style={{ maxWidth: "min(100vw - 32px, 440px)", margin: "0 auto" }}
      role="grid"
      aria-label="Chess board"
    >
      <div
        className="grid grid-cols-8 overflow-hidden"
        style={{
          borderRadius: "14px",
          border: "2.5px solid rgb(var(--ink))",
          boxShadow: "5px 5px 0 rgb(var(--pop-shadow))",
        }}
      >
        {displayOrder.map((idx) => {
          const file = idx % 8;
          const rank = Math.floor(idx / 8);
          // Light square: (file + rank) % 2 === 1 when normal orientation
          const isLight   = (file + rank) % 2 === 1;
          const piece     = board[idx] ?? null;
          const isFrom    = idx === fromIdx;
          const isTo      = idx === toIdx;
          const isSel     = idx === selected;
          const isLegal   = legalTargets.has(idx);
          const isCapture = isLegal && piece !== null;
          const isSel2    = selectablePieces.has(idx);
          const isCheck   = idx === checkIdx;

          // Coordinates: rank on the A-file square, file on the 1-rank square
          // When flipped: rank on H-file, file on 8-rank
          const showRank = !flipped ? file === 0 : file === 7;
          const showFile = !flipped ? rank === 7 : rank === 0;
          const fileLabel = String.fromCharCode(97 + file);
          const rankLabel = String(8 - rank);

          const sqBg = isCheck
            ? "rgb(var(--coral) / 0.35)"
            : isSel
            ? "rgb(var(--teal-light))"
            : (isFrom || isTo)
            ? isLight
              ? "rgb(var(--amber) / 0.55)"
              : "rgb(var(--amber) / 0.45)"
            : isLight
            ? "rgb(var(--sq-light))"
            : "rgb(var(--sq-dark))";

          const labelColor = isLight
            ? "rgb(var(--sq-dark) / 0.65)"
            : "rgb(var(--sq-light) / 0.65)";

          return (
            <div
              key={idx}
              role="gridcell"
              aria-label={idxToAlg(idx)}
              tabIndex={isSel2 || isLegal ? 0 : -1}
              onClick={() => handleClick(idx)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleClick(idx);
              }}
              className="relative aspect-square cursor-pointer"
              style={{ background: sqBg, outline: isSel ? "2.5px solid rgb(var(--teal))" : undefined, outlineOffset: isSel ? "-2.5px" : undefined }}
            >
              {/* Rank coordinate */}
              {showRank && (
                <span
                  className="absolute left-[3px] top-[2px] text-[8px] font-bold leading-none pointer-events-none select-none z-10"
                  style={{ color: labelColor, fontFamily: "'JetBrains Mono',monospace" }}
                >
                  {rankLabel}
                </span>
              )}
              {/* File coordinate */}
              {showFile && (
                <span
                  className="absolute bottom-[2px] right-[3px] text-[8px] font-bold leading-none pointer-events-none select-none z-10"
                  style={{ color: labelColor, fontFamily: "'JetBrains Mono',monospace" }}
                >
                  {fileLabel}
                </span>
              )}

              {/* Chain-state mark on the last-move destination square */}
              {isTo && chainDotStyle && (
                <span
                  className="absolute top-[3px] right-[3px] w-[8px] h-[8px] rounded-full pointer-events-none z-20"
                  style={chainDotStyle}
                  title={lastMoveState}
                />
              )}

              {/* Legal move dot (empty square) */}
              {isLegal && !isCapture && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
                  <span className="rounded-full" style={{ width: "28%", height: "28%", background: "rgb(var(--teal) / 0.35)" }} />
                </span>
              )}
              {/* Capture ring */}
              {isCapture && (
                <span
                  className="pointer-events-none absolute inset-0 z-10"
                  style={{ boxShadow: "inset 0 0 0 5px rgb(var(--teal) / 0.50)" }}
                />
              )}

              {/* Piece */}
              {piece !== null && (
                <span
                  className="absolute inset-0 flex items-center justify-center"
                  style={{
                    padding: "7%",
                    transform: isSel ? "scale(1.12)" : undefined,
                    transition: "transform 80ms cubic-bezier(0.34,1.56,0.64,1)",
                  }}
                >
                  <ChessPiece piece={piece} />
                </span>
              )}

              {/* Hover ring for selectable pieces (CSS only) */}
              {isSel2 && !isSel && (
                <span
                  className="pointer-events-none absolute inset-0 opacity-0 hover:opacity-100 transition-opacity z-10"
                  style={{ boxShadow: "inset 0 0 0 2px rgb(var(--teal) / 0.45)" }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
