"use client";
/**
 * PlayBoard: the interactive board (docs/design.md, "The board").
 *
 * - Squares: light --sq-light, dark --sq-dark, inside a sticker frame.
 * - Input: tap a piece then a square, or drag it. Illegal drops spring back.
 * - Legal targets: ink dots; captures: ink rings. Last move: amber inset ring.
 *   King in check: coral glow. Selected piece lifts with a pop shadow.
 * - Promotion: a sticker picker with the four pieces over the promotion square.
 * - Motion: the moved piece slides in; respects reduced motion.
 * - Chain: the last move's square carries its onchain state (grey queued,
 *   cyan sent, mint final) and a short "sealed" stamp the moment it is final.
 */
import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { parseFEN, inCheck } from "@final-move/chess";
import type { ChainRailEntry } from "@/lib/types";
import { ChessPiece } from "./ChessPieces";

const PIECE_NAMES: Record<string, string> = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };

function fenToBoard(fen: string): (string | null)[] {
  const placement = fen.split(" ")[0] ?? "";
  const board: (string | null)[] = [];
  for (const rank of placement.split("/")) {
    for (const ch of rank) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) board.push(null);
      else board.push(ch);
    }
  }
  while (board.length < 64) board.push(null);
  return board;
}

/** "e2" to render index (a8 = 0). */
export function algToIdx(alg: string): number {
  if (!alg || alg.length < 2) return -1;
  return (7 - (Number(alg[1]) - 1)) * 8 + (alg.charCodeAt(0) - 97);
}

/** Render index to algebraic square. */
export function idxToAlg(idx: number): string {
  return String.fromCharCode(97 + (idx % 8)) + String(8 - Math.floor(idx / 8));
}

interface PlayBoardProps {
  fen: string;
  legalMoves: string[];
  myColor: "w" | "b" | null;
  turn: "w" | "b";
  lastUci?: string;
  flipped?: boolean;
  onMove: (uci: string) => void;
  /** A piece was dragged to a square it can't move to. */
  onIllegal?: () => void;
  /** Moves the player may queue while it is the opponent's turn. */
  premoves?: string[];
  /** The queued premove, shown on the board until it plays or is cancelled. */
  premove?: string | null;
  onPremove?: (uci: string | null) => void;
  disabled?: boolean;
  /** Chain state of the last move, for the on-board mark. */
  lastMoveState?: ChainRailEntry["state"];
}

const CHAIN_MARK: Record<string, { color: string; label: string }> = {
  queued:   { color: "var(--ink-3)", label: "Queued for Arc" },
  sent:     { color: "var(--cyan)",  label: "Sent to Arc" },
  complete: { color: "var(--cyan)",  label: "Sent to Arc" },
  final:    { color: "var(--mint)",  label: "Final on Arc" },
  failed:   { color: "var(--coral)", label: "Not recorded yet" },
};

export function PlayBoard({
  fen,
  legalMoves,
  myColor,
  turn,
  lastUci,
  flipped: flippedProp = false,
  onMove,
  onIllegal,
  premoves,
  premove = null,
  onPremove,
  disabled = false,
  lastMoveState,
}: PlayBoardProps): React.JSX.Element {
  // The player's own pieces sit at the bottom.
  const flipped = myColor === "b" ? !flippedProp : flippedProp;

  const [selected, setSelected] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  const [drag, setDrag] = useState<{ idx: number; x: number; y: number; moved: boolean } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const board = useMemo(() => fenToBoard(fen), [fen]);
  const fromIdx = lastUci ? algToIdx(lastUci.slice(0, 2)) : -1;
  const toIdx = lastUci ? algToIdx(lastUci.slice(2, 4)) : -1;

  const checkIdx = useMemo(() => {
    try {
      const pos = parseFEN(fen);
      if (!inCheck(pos)) return -1;
      return board.findIndex((p) => p === (pos.turn === "w" ? "K" : "k"));
    } catch {
      return -1;
    }
  }, [fen, board]);

  const myTurn = !disabled && myColor !== null && myColor === turn;

  // While the opponent thinks, the player can queue a premove.
  const premoveMode = !myTurn && !disabled && myColor !== null && !!onPremove;
  const activeMoves = useMemo(
    () => (myTurn ? legalMoves : premoveMode ? premoves ?? [] : []),
    [myTurn, premoveMode, legalMoves, premoves],
  );

  const movable = useMemo<Set<number>>(() => {
    if (!myTurn && !premoveMode) return new Set();
    return new Set(activeMoves.map((u) => algToIdx(u.slice(0, 2))));
  }, [activeMoves, myTurn, premoveMode]);

  const targetsFrom = useCallback(
    (from: number) => {
      const alg = idxToAlg(from);
      return new Set(activeMoves.filter((u) => u.startsWith(alg)).map((u) => algToIdx(u.slice(2, 4))));
    },
    [activeMoves],
  );

  // Castling also works by dropping the king on its own rook, as on most chess sites.
  const resolveTarget = useCallback(
    (from: number, to: number): number | null => {
      const targets = targetsFrom(from);
      if (targets.has(to)) return to;
      const king = board[from];
      const rook = board[to];
      if ((king === "K" && rook === "R") || (king === "k" && rook === "r")) {
        const castleTo = to % 8 === 7 ? from + 2 : to % 8 === 0 ? from - 2 : -1;
        if (targets.has(castleTo)) return castleTo;
      }
      return null;
    },
    [board, targetsFrom],
  );
  const premoveFrom = premove ? algToIdx(premove.slice(0, 2)) : -1;
  const premoveTo = premove ? algToIdx(premove.slice(2, 4)) : -1;
  const activeFrom = drag?.idx ?? selected;
  const legalTargets = useMemo(() => (activeFrom === null ? new Set<number>() : targetsFrom(activeFrom)), [activeFrom, targetsFrom]);

  // A new position clears any half-made move.
  useEffect(() => { setSelected(null); setPromo(null); }, [fen]);

  const tryMove = useCallback(
    (from: number, rawTo: number): boolean => {
      const to = resolveTarget(from, rawTo);
      if (to === null) return false;
      const piece = board[from];
      const toAlg = idxToAlg(to);
      const promotes = (piece === "P" && toAlg[1] === "8") || (piece === "p" && toAlg[1] === "1");
      if (premoveMode) {
        // A queued promotion becomes a queen; there's no time to ask mid-move.
        onPremove?.(idxToAlg(from) + toAlg + (promotes ? "q" : ""));
        setSelected(null);
        return true;
      }
      if (promotes) {
        setPromo({ from, to });
        return true;
      }
      onMove(idxToAlg(from) + toAlg);
      setSelected(null);
      return true;
    },
    [board, onMove, onPremove, premoveMode, resolveTarget],
  );

  const handleSquare = useCallback(
    (idx: number) => {
      if ((!myTurn && !premoveMode) || promo) return;
      if (selected !== null && selected !== idx && tryMove(selected, idx)) return;
      // Tapping an empty square with nothing selected cancels a queued premove.
      if (premoveMode && selected === null && !movable.has(idx) && premove) onPremove?.(null);
      setSelected(movable.has(idx) && selected !== idx ? idx : null);
    },
    [myTurn, premoveMode, premove, onPremove, promo, selected, tryMove, movable],
  );

  // ── Drag ────────────────────────────────────────────────────────────────────
  const squareAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest("[data-sq]");
    return el ? Number(el.getAttribute("data-sq")) : null;
  };
  const onPointerDown = (idx: number) => (e: React.PointerEvent) => {
    if ((!myTurn && !premoveMode) || promo || !movable.has(idx) || e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ idx, x: e.clientX, y: e.clientY, moved: false });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const moved = drag.moved || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6;
    setDrag({ ...drag, x: e.clientX, y: e.clientY, moved });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const target = squareAt(e.clientX, e.clientY);
    const d = drag;
    setDrag(null);
    if (!d.moved) { handleSquare(d.idx); return; } // a tap, not a drag
    if (target === null || !tryMove(d.idx, target)) { // spring back
      setSelected(null);
      if (target !== null && target !== d.idx) onIllegal?.();
    }
  };

  const order = useMemo(() => {
    const all = Array.from({ length: 64 }, (_, i) => i);
    return flipped ? all.reverse() : all;
  }, [flipped]);

  // Screen position of a render index (0..7 col/row on screen)
  const screenOf = (idx: number) => {
    const file = idx % 8, rank = Math.floor(idx / 8);
    return flipped ? { c: 7 - file, r: 7 - rank } : { c: file, r: rank };
  };

  // Slide the last moved piece in from its origin square.
  const slide = fromIdx >= 0 && toIdx >= 0
    ? { dx: (screenOf(fromIdx).c - screenOf(toIdx).c) * 100, dy: (screenOf(fromIdx).r - screenOf(toIdx).r) * 100 }
    : null;

  // Briefly stamp a move the moment it becomes final on Arc.
  const [stampFor, setStampFor] = useState<string | null>(null);
  const prevState = useRef<{ uci?: string; state?: string }>({});
  useEffect(() => {
    const prev = prevState.current;
    if (lastUci && lastMoveState === "final" && !(prev.uci === lastUci && prev.state === "final")) {
      setStampFor(lastUci);
      const t = setTimeout(() => setStampFor(null), 900);
      prevState.current = { uci: lastUci, state: lastMoveState };
      return () => clearTimeout(t);
    }
    prevState.current = { uci: lastUci, state: lastMoveState };
    return undefined;
  }, [lastUci, lastMoveState]);

  const mark = lastMoveState ? CHAIN_MARK[lastMoveState] : undefined;
  const sqPx = boardRef.current ? boardRef.current.getBoundingClientRect().width / 8 : 56;
  const boardRect = boardRef.current?.getBoundingClientRect();

  return (
    <div className="relative w-full select-none" style={{ maxWidth: "min(100vw - 32px, 76vh, 600px)", margin: "0 auto" }}>
      <div
        ref={boardRef}
        role="grid"
        aria-label={`Chess board, ${turn === "w" ? "white" : "black"} to move${myTurn ? ", your move" : ""}`}
        className="relative grid grid-cols-8 overflow-hidden touch-none"
        style={{
          borderRadius: "var(--r)",
          border: "var(--line) solid rgb(var(--ink))",
          boxShadow: "6px 6px 0 rgb(var(--pop-shadow))",
          background: "rgb(var(--sq-light))",
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        {order.map((idx) => {
          const file = idx % 8;
          const rank = Math.floor(idx / 8);
          const isLight = (file + rank) % 2 === 0; // a8 and h1 are light squares
          const piece = board[idx] ?? null;
          const isLast = idx === fromIdx || idx === toIdx;
          const isSel = idx === selected;
          const isLegal = legalTargets.has(idx);
          const isCapture = isLegal && piece !== null;
          const isCheck = idx === checkIdx;
          const dragging = drag?.idx === idx && drag.moved;
          const { c, r } = screenOf(idx);
          const name = piece ? `${piece === piece.toUpperCase() ? "white" : "black"} ${PIECE_NAMES[piece.toLowerCase()]}` : "empty";

          return (
            <div
              key={idx}
              data-sq={idx}
              role="gridcell"
              aria-label={`${idxToAlg(idx)}, ${name}${isLegal ? ", legal move" : ""}`}
              aria-selected={isSel}
              tabIndex={movable.has(idx) || isLegal ? 0 : -1}
              onPointerDown={onPointerDown(idx)}
              onClick={() => { if (!movable.has(idx) || (!myTurn && !premoveMode)) handleSquare(idx); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSquare(idx); } }}
              className="relative aspect-square"
              style={{
                background: isCheck
                  ? "radial-gradient(circle, rgb(var(--coral) / 0.85) 0%, rgb(var(--coral) / 0.35) 55%, transparent 75%), rgb(var(--sq-" + (isLight ? "light" : "dark") + "))"
                  : `rgb(var(--sq-${isLight ? "light" : "dark"}))`,
                cursor: movable.has(idx) || isLegal ? "pointer" : "default",
              }}
            >
              {/* Last move: amber inset ring */}
              {isLast && <span className="pointer-events-none absolute inset-0" style={{ boxShadow: "inset 0 0 0 4px rgb(var(--amber))", background: "rgb(var(--amber) / 0.18)" }} />}
              {/* Selected square */}
              {isSel && <span className="pointer-events-none absolute inset-0" style={{ background: "rgb(var(--violet) / 0.22)" }} />}
              {/* Queued premove */}
              {(idx === premoveFrom || idx === premoveTo) && <span className="pointer-events-none absolute inset-0" style={{ background: "rgb(var(--cyan) / 0.35)" }} aria-hidden />}

              {/* Coordinates on the edge squares */}
              {c === 0 && (
                <span className="pointer-events-none absolute left-[4px] top-[2px] font-sans text-[10px] font-extrabold leading-none" style={{ color: "rgb(var(--ink) / 0.45)" }}>
                  {String(8 - rank)}
                </span>
              )}
              {r === 7 && (
                <span className="pointer-events-none absolute bottom-[2px] right-[4px] font-sans text-[10px] font-extrabold leading-none" style={{ color: "rgb(var(--ink) / 0.45)" }}>
                  {String.fromCharCode(97 + file)}
                </span>
              )}

              {/* Piece */}
              {piece !== null && (
                <span
                  key={idx === toIdx ? `${lastUci}` : undefined}
                  className="absolute inset-0 flex items-center justify-center"
                  style={{
                    padding: "6%",
                    opacity: dragging ? 0.25 : 1,
                    transform: isSel ? "translate(-1px, -3px) scale(1.08)" : undefined,
                    filter: isSel ? "drop-shadow(2px 3px 0 rgb(var(--pop-shadow)))" : undefined,
                    transition: "transform 140ms var(--spring)",
                    animation: idx === toIdx && slide ? "piece-slide 140ms var(--spring) both" : undefined,
                    ["--dx" as string]: `${slide?.dx ?? 0}%`,
                    ["--dy" as string]: `${slide?.dy ?? 0}%`,
                  }}
                >
                  <ChessPiece piece={piece} />
                </span>
              )}

              {/* Legal targets: ink dot, or ring for a capture */}
              {isLegal && !isCapture && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="rounded-full" style={{ width: "30%", height: "30%", background: "rgb(var(--piece-line) / 0.22)" }} />
                </span>
              )}
              {isCapture && <span className="pointer-events-none absolute inset-[4%] rounded-full" style={{ boxShadow: "inset 0 0 0 5px rgb(var(--piece-line) / 0.28)" }} />}

              {/* Chain mark on the last move's square */}
              {idx === toIdx && mark && (
                <span
                  className="pointer-events-none absolute right-[5%] top-[5%] h-[16%] w-[16%] rounded-full"
                  style={{
                    background: `rgb(${mark.color})`,
                    border: "2px solid rgb(var(--piece-line))",
                    animation: lastMoveState === "sent" || lastMoveState === "complete" ? "pulse 1s ease-in-out infinite" : undefined,
                  }}
                  title={mark.label}
                  aria-label={mark.label}
                />
              )}
              {idx === toIdx && stampFor === lastUci && (
                <span
                  className="pointer-events-none absolute inset-[3%] rounded-[12px]"
                  style={{ boxShadow: "inset 0 0 0 3px rgb(var(--mint))", animation: "seal-stamp 900ms var(--spring) both" }}
                  aria-hidden
                />
              )}
            </div>
          );
        })}

        {/* Promotion picker over the promotion square's file */}
        {promo && (() => {
          const { c } = screenOf(promo.to);
          const white = board[promo.from] === "P";
          return (
            <div className="absolute inset-0 z-30" style={{ background: "rgb(var(--scrim) / 0.35)" }} onClick={() => setPromo(null)}>
              <div
                role="dialog"
                aria-label="Choose a piece to promote to"
                className="absolute flex flex-col overflow-hidden"
                style={{
                  left: `${c * 12.5}%`, top: 0, width: "12.5%",
                  background: "rgb(var(--cloud))",
                  border: "var(--line) solid rgb(var(--ink))",
                  borderRadius: "var(--r)",
                  boxShadow: "4px 4px 0 rgb(var(--pop-shadow))",
                  animation: "pop-in 160ms var(--spring) both",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {(["q", "r", "b", "n"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-label={`Promote to ${PIECE_NAMES[p]}`}
                    className="aspect-square p-[8%] hover:bg-violet-light focus-visible:bg-violet-light"
                    onClick={() => { onMove(idxToAlg(promo.from) + idxToAlg(promo.to) + p); setPromo(null); setSelected(null); }}
                  >
                    <ChessPiece piece={white ? p.toUpperCase() : p} />
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* The dragged piece follows the pointer */}
      {drag?.moved && board[drag.idx] && boardRect && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            width: sqPx * 1.12, height: sqPx * 1.12,
            left: drag.x - (sqPx * 1.12) / 2, top: drag.y - (sqPx * 1.12) / 2,
            filter: "drop-shadow(3px 4px 0 rgb(var(--pop-shadow)))",
          }}
        >
          <ChessPiece piece={board[drag.idx]!} />
        </div>
      )}
    </div>
  );
}
