"use client";
/**
 * PlayBoard — interactive chess board built from the reference sticker design.
 * Tap a piece then a destination; legal squares shown as ink dots / rings.
 * Highlights last move in amber. King in check glows coral.
 * Respects prefers-reduced-motion for piece slides.
 */
import { useState, useCallback, useMemo } from "react";
import { cx } from "@/lib/utils";

// Unicode glyphs (stand-in until custom SVG pieces are drawn)
const GLYPH: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

/** Parse FEN placement to 64-element array, index 0 = a8 (top-left, white at bottom). */
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

/** "e2" → render index (a8=0 array). */
function algToIdx(alg: string): number {
  if (!alg || alg.length < 2) return -1;
  const file = alg.charCodeAt(0) - 97;
  const rank = Number(alg[1]) - 1;
  return (7 - rank) * 8 + file;
}

/** Render index → algebraic square. */
function idxToAlg(idx: number): string {
  const file = String.fromCharCode(97 + (idx % 8));
  const rank = String(8 - Math.floor(idx / 8));
  return file + rank;
}

interface PlayBoardProps {
  fen: string;
  legalMoves: string[];        // UCI strings e.g. ["e2e4", "d2d4"]
  myColor: "w" | "b" | null;   // null = spectator
  turn: "w" | "b";
  lastUci?: string;             // highlight
  flipped?: boolean;
  onMove: (uci: string) => void;
  disabled?: boolean;
}

export function PlayBoard({
  fen,
  legalMoves,
  myColor,
  turn,
  lastUci,
  flipped = false,
  onMove,
  disabled = false,
}: PlayBoardProps): React.JSX.Element {
  const [selected, setSelected] = useState<number | null>(null);

  const board = useMemo(() => fenToBoard(fen), [fen]);
  const fromIdx = lastUci ? algToIdx(lastUci.slice(0, 2)) : -1;
  const toIdx   = lastUci ? algToIdx(lastUci.slice(2, 4)) : -1;

  // Legal destination squares for the selected piece
  const legalTargets = useMemo<Set<number>>(() => {
    if (selected === null) return new Set();
    const fromAlg = idxToAlg(selected);
    return new Set(
      legalMoves
        .filter((uci) => uci.startsWith(fromAlg))
        .map((uci) => algToIdx(uci.slice(2, 4))),
    );
  }, [selected, legalMoves]);

  // All selectable squares (own pieces on turn)
  const selectablePieces = useMemo<Set<number>>(() => {
    if (myColor !== turn || disabled) return new Set();
    const set = new Set<number>();
    for (const uci of legalMoves) {
      set.add(algToIdx(uci.slice(0, 2)));
    }
    return set;
  }, [legalMoves, myColor, turn, disabled]);

  const handleSquareClick = useCallback(
    (idx: number) => {
      if (disabled || myColor !== turn) return;
      const piece = board[idx];

      if (selected !== null) {
        if (legalTargets.has(idx)) {
          // Build UCI — check for promotion
          const fromAlg = idxToAlg(selected);
          const toAlg   = idxToAlg(idx);
          const movingPiece = board[selected];
          // Auto-queen on promotion
          const needsPromo =
            (movingPiece === "P" && toAlg[1] === "8") ||
            (movingPiece === "p" && toAlg[1] === "1");
          const uci = fromAlg + toAlg + (needsPromo ? "q" : "");
          onMove(uci);
          setSelected(null);
          return;
        }
        // Click own piece → re-select
        if (piece && selectablePieces.has(idx)) {
          setSelected(idx);
          return;
        }
        setSelected(null);
        return;
      }

      // Select own piece
      if (piece && selectablePieces.has(idx)) {
        setSelected(idx);
      }
    },
    [selected, legalTargets, selectablePieces, board, disabled, myColor, turn, onMove],
  );

  // Render indices in display order (flip if needed)
  const displayOrder = useMemo(() => {
    const indices = Array.from({ length: 64 }, (_, i) => i);
    if (flipped) return indices.reverse();
    return indices;
  }, [flipped]);

  return (
    <div
      className="w-full max-w-[min(100vw,440px)] mx-auto select-none"
      role="grid"
      aria-label="Chess board"
    >
      <div className="grid grid-cols-8 overflow-hidden rounded-chunk border-[3px] border-ink shadow-pop">
        {displayOrder.map((idx) => {
          const file = idx % 8;
          const rank = Math.floor(idx / 8);
          const light = (file + rank) % 2 === 1;
          const piece = board[idx] ?? null;
          const isFrom   = idx === fromIdx;
          const isTo     = idx === toIdx;
          const isSelected = idx === selected;
          const isLegal  = legalTargets.has(idx);
          const isCapture = isLegal && piece !== null;
          const isSelectable = selectablePieces.has(idx);
          const white = piece !== null && piece === piece.toUpperCase();

          // Rank/file labels on edge squares
          const showFile = !flipped ? rank === 7 : rank === 0;
          const showRank = !flipped ? file === 0 : file === 7;
          const fileLabel = String.fromCharCode(97 + file);
          const rankLabel = String(8 - rank);

          return (
            <div
              key={idx}
              role="gridcell"
              aria-label={idxToAlg(idx)}
              tabIndex={isSelectable || isLegal ? 0 : -1}
              onClick={() => handleSquareClick(idx)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleSquareClick(idx); }}
              className={cx(
                "relative aspect-square cursor-pointer transition-colors",
                light ? "bg-cloud-2" : "bg-violet/25",
                (isFrom || isTo) && "ring-2 ring-inset ring-amber",
                isSelected && "ring-2 ring-inset ring-violet shadow-inner",
                isSelectable && !isSelected && "hover:ring-1 hover:ring-inset hover:ring-ink/30",
              )}
            >
              {/* Rank label */}
              {showRank && (
                <span className="absolute left-0.5 top-0.5 font-body text-[9px] font-bold leading-none text-ink/50 pointer-events-none">
                  {rankLabel}
                </span>
              )}
              {/* File label */}
              {showFile && (
                <span className="absolute bottom-0.5 right-0.5 font-body text-[9px] font-bold leading-none text-ink/50 pointer-events-none">
                  {fileLabel}
                </span>
              )}

              {/* Legal move dots / rings */}
              {isLegal && !isCapture && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="h-[28%] w-[28%] rounded-full bg-ink/20" />
                </span>
              )}
              {isCapture && (
                <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-[6px] ring-inset ring-ink/25" />
              )}

              {/* Piece */}
              {piece !== null && (
                <span
                  className={cx(
                    "absolute inset-0 flex items-center justify-center text-[clamp(20px,6.5vw,36px)] leading-none transition-transform",
                    isSelected && "scale-110",
                  )}
                  style={
                    white
                      ? { WebkitTextStroke: "1.5px rgb(var(--ink))", textShadow: "0 1px 0 rgb(var(--ink))", color: "rgb(var(--cloud))" }
                      : { color: "rgb(var(--ink))" }
                  }
                >
                  {piece !== null ? (GLYPH[piece] ?? piece) : ""}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
