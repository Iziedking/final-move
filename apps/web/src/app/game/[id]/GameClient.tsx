"use client";
import Link from "next/link";
import type React from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useGameWs } from "@/lib/useGameWs";
import { PlayBoard } from "@/components/PlayBoard";
import { PlayerBar } from "@/components/PlayerBar";
import { Clock } from "@/components/Clock";
import { ThemeToggle } from "@/components/ThemeToggle";
import { explorerTx } from "@/lib/utils";
import { API_BASE } from "@/lib/api";
import type { PlayerInfo, ChainRailEntry } from "@/lib/types";

interface Props {
  gameId: string;
  playerId?: string;
  myColor?: "w" | "b";
}

// ── Confetti (CSS-only, no dep) ───────────────────────────────────────────────
function Confetti() {
  const colours = ["var(--teal)", "var(--amber)", "var(--mint)", "var(--coral)", "var(--sky-blue)"];
  return (
    <div className="pointer-events-none fixed inset-0 z-[999] overflow-hidden" aria-hidden>
      {Array.from({ length: 40 }).map((_, i) => (
        <span
          key={i}
          className="absolute top-0 rounded-sm"
          style={{
            left: `${(i * 2.5) % 100}%`,
            width: `${6 + (i % 5)}px`,
            height: `${10 + (i % 7)}px`,
            background: `rgb(${colours[i % colours.length]})`,
            animation: `confetti-fall ${1.2 + (i % 4) * 0.3}s ${(i % 8) * 0.12}s cubic-bezier(.25,.46,.45,.94) forwards`,
          }}
        />
      ))}
    </div>
  );
}

// ── Chain rail ────────────────────────────────────────────────────────────────
const STATE_DOT: Record<string, string> = {
  queued:   "rgb(var(--ink-3))",
  sent:     "rgb(var(--amber))",
  complete: "rgb(var(--amber))",
  final:    "rgb(var(--teal))",
};
const STATE_LABEL: Record<string, string> = {
  queued:   "queued",
  sent:     "sent",
  complete: "confirming",
  final:    "final",
};

function ChainRailPanel({ entries }: { entries: ChainRailEntry[] }) {
  const finalCount = entries.filter((e) => e.state === "final").length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 mb-0.5">
        <span
          className="h-2 w-2 rounded-full flex-shrink-0"
          style={{ background: finalCount > 0 ? "rgb(var(--teal))" : "rgb(var(--ink-3))" }}
        />
        <span className="text-[10px] font-extrabold font-display uppercase tracking-widest" style={{ color: "rgb(var(--ink-3))" }}>
          {finalCount}/{entries.length} on Arc
        </span>
      </div>
      <div className="max-h-[260px] overflow-y-auto flex flex-col gap-1 pr-0.5">
        {entries.map((e) => (
          <div
            key={e.ply}
            className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] border"
            style={{
              background:  "rgb(var(--cloud))",
              borderColor: e.state === "final" ? "rgb(var(--teal) / 0.5)" : "rgb(var(--ink) / 0.10)",
            }}
          >
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: STATE_DOT[e.state] }} />
            <span className="font-bold w-5 shrink-0 tabular-nums font-display" style={{ color: "rgb(var(--ink))" }}>
              {e.ply}.
            </span>
            <span className="mono shrink-0 font-semibold flex-1" style={{ color: "rgb(var(--ink-2))" }}>
              {e.san || "—"}
            </span>
            <span className="ml-auto text-[9px] font-bold shrink-0 uppercase" style={{ color: STATE_DOT[e.state] }}>
              {STATE_LABEL[e.state]}
            </span>
            {e.txHash && (
              <a
                href={explorerTx(e.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="mono text-[9px] shrink-0 hover:opacity-70 transition-opacity"
                style={{ color: "rgb(var(--teal))" }}
                title={e.txHash}
              >
                ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SAN move list ─────────────────────────────────────────────────────────────
interface SanMoveListProps {
  chainRail: ChainRailEntry[];
  reviewPly: number | null;
  onReviewPly: (ply: number | null) => void;
}

function SanMoveList({ chainRail, reviewPly, onReviewPly }: SanMoveListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  // Sort ascending
  const sorted = [...chainRail].sort((a, b) => a.ply - b.ply);
  // Group into pairs: [[w,b], [w,b], ...]
  const pairs: Array<[ChainRailEntry, ChainRailEntry | null]> = [];
  for (let i = 0; i < sorted.length; i += 2) {
    pairs.push([sorted[i]!, sorted[i + 1] ?? null]);
  }

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [sorted.length]);

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center py-4">
        <span className="text-xs font-semibold" style={{ color: "rgb(var(--ink-3))" }}>No moves yet</span>
      </div>
    );
  }

  return (
    <div ref={listRef} className="overflow-y-auto max-h-[120px] sm:max-h-[180px]">
      {reviewPly !== null && (
        <div className="sticky top-0 flex justify-end pb-1" style={{ background: "rgb(var(--cloud))" }}>
          <button
            onClick={() => onReviewPly(null)}
            className="chip text-[9px]"
            style={{ background: "rgb(var(--teal))", color: "#fff", borderColor: "rgb(var(--ink))" }}
          >
            Back to live
          </button>
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        {pairs.map(([white, black], pairIdx) => (
          <div key={pairIdx} className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px]">
            <span
              className="w-5 shrink-0 font-bold tabular-nums mono"
              style={{ color: "rgb(var(--ink-3))" }}
            >
              {pairIdx + 1}.
            </span>
            {[white, black].map((m, j) => {
              if (!m) return <span key={j} className="flex-1" />;
              const isCurrent = reviewPly === m.ply;
              return (
                <button
                  key={j}
                  onClick={() => onReviewPly(isCurrent ? null : m.ply)}
                  className="flex-1 text-left rounded px-1.5 py-0.5 mono font-semibold transition-colors"
                  style={{
                    background:  isCurrent ? "rgb(var(--teal-light))" : "transparent",
                    color:       isCurrent ? "rgb(var(--teal-deep))"  : "rgb(var(--ink-2))",
                    fontWeight:  isCurrent ? 700 : 600,
                    borderRadius: "6px",
                  }}
                  title={`Ply ${m.ply} — ${STATE_LABEL[m.state]}`}
                >
                  {m.san || m.ply}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── End screen ────────────────────────────────────────────────────────────────
function EndScreen({
  result, reason, myColor, explorerHash, plyCount, onRematch, rematchLoading,
  rematchAvailable,
}: {
  result?: string;
  reason?: string;
  myColor: "w" | "b" | null;
  explorerHash?: string;
  plyCount: number;
  onRematch: () => void;
  rematchLoading: boolean;
  rematchAvailable: boolean;
}) {
  const won  = (result === "white" && myColor === "w") || (result === "black" && myColor === "b");
  const drew = result === "draw";
  const lost = !won && !drew && result !== "aborted";

  const label = result === "aborted" ? "Game aborted"
    : drew     ? "Draw"
    : won      ? "You won"
    : lost     ? "You lost"
    : result === "white" ? "White wins" : "Black wins";

  const stampColor = result === "aborted" ? "rgb(var(--ink-3))"
    : drew  ? "rgb(var(--draw))"
    : won   ? "rgb(var(--teal))"
    :          "rgb(var(--danger))";

  return (
    <div
      className="sticker-card-lg w-full p-6 text-center"
      style={{ animation: "drop-in 0.25s ease-out" }}
    >
      {/* Result stamp */}
      <div
        className="inline-flex items-center justify-center rounded-2xl border-2 px-6 py-2 font-display text-2xl font-extrabold mb-3"
        style={{
          background: stampColor,
          color: "#fff",
          borderColor: "rgb(var(--ink))",
          boxShadow: "4px 4px 0 rgb(var(--pop-shadow))",
        }}
      >
        {label}
      </div>

      {reason && (
        <p className="text-sm font-semibold mb-3 capitalize" style={{ color: "rgb(var(--ink-2))" }}>
          {reason.replace(/-/g, " ")}
        </p>
      )}

      {result !== "aborted" && (
        <p className="text-sm font-medium mb-4" style={{ color: "rgb(var(--ink-2))" }}>
          <strong style={{ color: "rgb(var(--ink))" }}>{plyCount} moves</strong> sealed on Arc.
          Every one is permanent.
        </p>
      )}

      <div className="flex flex-col gap-2.5">
        {explorerHash && (
          <a
            href={explorerTx(explorerHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="pop-btn w-full rounded-2xl py-2.5 text-sm font-bold"
          >
            View on Arc Explorer →
          </a>
        )}

        {rematchAvailable && (
          <button
            onClick={onRematch}
            disabled={rematchLoading}
            className="pop-btn-ghost pop-btn w-full rounded-2xl py-2.5 text-sm font-bold"
          >
            {rematchLoading ? "Sending…" : "Rematch"}
          </button>
        )}

        <Link href="/" className="pop-btn-ghost pop-btn w-full rounded-2xl py-2.5 text-sm font-bold text-center">
          Home
        </Link>
      </div>
    </div>
  );
}

// ── Reconnecting banner ───────────────────────────────────────────────────────
function ReconnectingBanner({ connected }: { connected: boolean }) {
  if (connected) return null;
  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-2xl border-2 px-5 py-2.5 flex items-center gap-2.5 font-display text-sm font-bold"
      style={{
        background:  "rgb(var(--cloud))",
        borderColor: "rgb(var(--amber))",
        color:       "rgb(var(--ink))",
        boxShadow:   "3px 3px 0 rgb(var(--pop-shadow))",
      }}
    >
      <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: "rgb(var(--amber))" }} />
      Reconnecting…
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function GameClient({ gameId, playerId: injectedPlayerId, myColor: injectedColor }: Props): React.JSX.Element {
  const { data: session } = useSession();
  const playerId = injectedPlayerId ?? session?.user?.id ?? "guest";
  const router   = useRouter();

  const { connected, gameState, chainRail, sendMove, drawOfferedBy, ratingDelta, rematchGameId } = useGameWs(gameId, playerId);

  const [legalMoves, setLegalMoves]       = useState<string[]>([]);
  const [manualFlip, setManualFlip]       = useState(false);
  const [showRail, setShowRail]           = useState(false);
  const [drawSent, setDrawSent]           = useState(false);
  const [rematchLoading, setRematchLoading] = useState(false);
  const [reviewPly, setReviewPly]         = useState<number | null>(null);
  const [reviewFen, setReviewFen]         = useState<string | null>(null);

  // Fetch legal moves whenever FEN changes
  useEffect(() => {
    if (!gameState || (gameState.status !== "live" && gameState.status !== "waiting")) return;
    fetch(`${API_BASE}/v1/games/${gameId}`)
      .then((r) => r.json())
      .then((d: { legalMoves?: string[] }) => setLegalMoves(d.legalMoves ?? []))
      .catch(() => {});
  }, [gameId, gameState?.fen, gameState?.status]);

  // Fetch replay FEN when reviewing a historical ply
  useEffect(() => {
    if (reviewPly === null) { setReviewFen(null); return; }
    fetch(`${API_BASE}/v1/games/${gameId}/fen-at/${reviewPly}`)
      .then((r) => r.json())
      .then((d: { fen?: string }) => setReviewFen(d.fen ?? null))
      .catch(() => setReviewFen(null));
  }, [gameId, reviewPly]);

  const handleRematch = useCallback(async () => {
    setRematchLoading(true);
    await fetch(`${API_BASE}/v1/games/${gameId}/rematch`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    }).catch(() => {});
    setRematchLoading(false);
  }, [gameId, playerId]);

  // Navigate to rematch game when ready
  useEffect(() => {
    if (rematchGameId) router.push(`/game/${rematchGameId}?pid=${playerId}`);
  }, [rematchGameId, playerId, router]);

  // ── Loading states ────────────────────────────────────────────────────────
  if (!gameState && !connected) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "rgb(var(--sky))" }}>
        <div className="sticker-card-sm px-8 py-6 text-center" style={{ animation: "pop-in 0.2s ease-out" }}>
          <div className="h-5 w-5 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
               style={{ borderColor: "rgb(var(--teal))", borderTopColor: "transparent" }} />
          <p className="font-display font-bold text-base" style={{ color: "rgb(var(--ink))" }}>Connecting…</p>
          <p className="text-xs mt-1" style={{ color: "rgb(var(--ink-3))" }}>Game {gameId.slice(-6)}</p>
        </div>
      </div>
    );
  }
  if (!gameState) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "rgb(var(--sky))" }}>
        <div className="sticker-card-sm px-8 py-6 text-center">
          <div className="h-5 w-5 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
               style={{ borderColor: "rgb(var(--ink-3))", borderTopColor: "transparent" }} />
          <p className="font-display font-bold text-base" style={{ color: "rgb(var(--ink))" }}>Loading…</p>
        </div>
      </div>
    );
  }

  const gs        = gameState;
  const myColor   = injectedColor ?? (gs.white.id === playerId ? "w" : gs.black.id === playerId ? "b" : null);
  const turn      = gs.turn;
  const iAmOnMove = myColor === turn && (gs.status === "live" || gs.status === "waiting");
  const ended     = gs.status === "ended" || gs.status === "aborted";
  const isCheckmate = ended && gs.reason === "checkmate";
  const lastRailEntry = [...chainRail].sort((a, b) => b.ply - a.ply)[0];
  const lastMoveState = lastRailEntry?.state;
  const lastUci       = gs.moves[gs.moves.length - 1];

  // Player orientation: bottom = my piece side, top = opponent
  // manualFlip inverts this
  const bottomIsWhite = myColor === "b" ? manualFlip : !manualFlip;
  const topPlayer:    PlayerInfo = bottomIsWhite ? gs.black : gs.white;
  const bottomPlayer: PlayerInfo = bottomIsWhite ? gs.white : gs.black;
  const topMs    = topPlayer.color    === "w" ? gs.clockWMs : gs.clockBMs;
  const bottomMs = bottomPlayer.color === "w" ? gs.clockWMs : gs.clockBMs;
  const topActive    = turn === topPlayer.color    && gs.status === "live";
  const bottomActive = turn === bottomPlayer.color && gs.status === "live";

  // FEN to display: review fen if reviewing, else live fen
  const displayFen = reviewFen ?? gs.fen;

  // Explorer hash for the last final move
  const explorerHash = chainRail.find((e) => e.state === "final")?.txHash;

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      {isCheckmate && won(gs.result, myColor) && <Confetti />}

      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-2.5 border-b"
        style={{ background: "rgb(var(--cloud) / 0.90)", borderColor: "rgb(var(--ink) / 0.08)" }}
      >
        <Link href="/" className="font-display font-extrabold text-base" style={{ color: "rgb(var(--ink))" }}>
          Final Move
        </Link>
        <div className="flex items-center gap-2">
          {/* Connection indicator */}
          <span
            className="h-2 w-2 rounded-full border"
            style={{
              background:  connected ? "rgb(var(--teal))" : "rgb(var(--amber))",
              borderColor: "rgb(var(--ink) / 0.3)",
            }}
          />
          {/* Chain rail toggle */}
          <button
            onClick={() => setShowRail((v) => !v)}
            className="pop-btn-ghost pop-btn rounded-full px-3 py-1 text-xs font-bold"
            style={showRail ? { background: "rgb(var(--teal-light))" } : undefined}
          >
            Chain
          </button>
          {/* Flip board */}
          <button
            onClick={() => setManualFlip((v) => !v)}
            className="rounded-full px-2.5 py-1 text-xs font-bold border transition-all hover:opacity-80"
            style={{ borderColor: "rgb(var(--ink) / 0.15)", color: "rgb(var(--ink-2))" }}
            title="Flip board"
          >
            Flip
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* Main layout: board + sidebar */}
      <main className="flex flex-1 flex-col lg:flex-row items-start justify-center gap-3 px-4 py-4 max-w-5xl mx-auto w-full">

        {/* Board column */}
        <div className="flex flex-col gap-2 w-full lg:max-w-[440px] min-w-0">

          {/* Top player bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <PlayerBar player={topPlayer} active={topActive} />
            </div>
            <Clock ms={topMs} running={topActive} />
          </div>

          {/* Board */}
          <PlayBoard
            fen={displayFen}
            legalMoves={reviewPly !== null ? [] : iAmOnMove ? legalMoves : []}
            myColor={myColor}
            turn={turn}
            lastUci={lastUci}
            flipped={manualFlip}
            onMove={sendMove}
            disabled={!iAmOnMove || ended || reviewPly !== null}
            lastMoveState={lastMoveState}
          />

          {/* Bottom player bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <PlayerBar player={bottomPlayer} active={bottomActive} />
            </div>
            <Clock ms={bottomMs} running={bottomActive} />
          </div>

          {/* Action buttons — resign / draw (live games only) */}
          {!ended && gs.status === "live" && myColor && (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (confirm("Resign this game?")) {
                    fetch(`${API_BASE}/v1/games/${gameId}/resign`, {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ playerId }),
                    }).catch(() => {});
                  }
                }}
                className="pop-btn pop-btn-danger flex-1 rounded-2xl px-3 py-2 text-sm font-bold"
              >
                Resign
              </button>
              <button
                disabled={drawSent}
                onClick={() => {
                  setDrawSent(true);
                  fetch(`${API_BASE}/v1/games/${gameId}/draw-offer`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ playerId }),
                  }).catch(() => {});
                }}
                className="pop-btn-ghost pop-btn flex-1 rounded-2xl px-3 py-2 text-sm font-bold"
              >
                {drawSent ? "Draw offered" : "Offer draw"}
              </button>
            </div>
          )}
        </div>

        {/* Sidebar column */}
        <div className="flex flex-col gap-2.5 w-full lg:w-[220px] min-w-0">

          {/* SAN move list */}
          <div className="sticker-card p-3">
            <p className="text-[10px] font-extrabold uppercase tracking-widest mb-2 font-display" style={{ color: "rgb(var(--ink-3))" }}>
              Moves
            </p>
            <SanMoveList
              chainRail={chainRail}
              reviewPly={reviewPly}
              onReviewPly={setReviewPly}
            />
          </div>

          {/* Chain rail */}
          {showRail && (
            <div className="sticker-card p-3">
              <p className="text-[10px] font-extrabold uppercase tracking-widest mb-2 font-display" style={{ color: "rgb(var(--ink-3))" }}>
                Chain
              </p>
              <ChainRailPanel entries={chainRail} />
            </div>
          )}

          {/* Draw offer banner */}
          {drawOfferedBy && drawOfferedBy !== playerId && !ended && (
            <div
              className="sticker-card-sm p-3 flex items-center justify-between gap-2"
              style={{ borderColor: "rgb(var(--amber))", background: "rgb(var(--amber) / 0.08)" }}
            >
              <span className="text-sm font-bold" style={{ color: "rgb(var(--ink))" }}>Draw offered</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => {
                    fetch(`${API_BASE}/v1/games/${gameId}/draw-offer`, {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ playerId }),
                    }).catch(() => {});
                  }}
                  className="pop-btn rounded-full px-3 py-1 text-xs"
                >Accept</button>
                <button onClick={() => {}} className="pop-btn-ghost pop-btn rounded-full px-3 py-1 text-xs">
                  Decline
                </button>
              </div>
            </div>
          )}

          {/* Rating delta */}
          {ended && ratingDelta && myColor && (
            <div className="sticker-card-sm p-3 flex items-center justify-around">
              {([["White", ratingDelta.white], ["Black", ratingDelta.black]] as [string, number][]).map(([label, delta]) => (
                <div key={label} className="text-center">
                  <div className="text-[10px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>{label} μ</div>
                  <div
                    className="font-display font-extrabold text-lg tabular-nums"
                    style={{
                      color: delta > 0 ? "rgb(var(--teal))" : delta < 0 ? "rgb(var(--danger))" : "rgb(var(--ink-2))",
                    }}
                  >
                    {delta > 0 ? "+" : ""}{delta.toFixed(1)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* End screen */}
          {ended && (
            <EndScreen
              result={gs.result}
              reason={gs.reason}
              myColor={myColor}
              explorerHash={explorerHash}
              plyCount={gs.plyCount}
              onRematch={handleRematch}
              rematchLoading={rematchLoading}
              rematchAvailable={gs.white.kind !== "bot" && gs.black.kind !== "bot"}
            />
          )}
        </div>
      </main>

      <ReconnectingBanner connected={connected} />
    </div>
  );
}

/** Helper: did this player win? */
function won(result: string | undefined, myColor: "w" | "b" | null) {
  return (result === "white" && myColor === "w") || (result === "black" && myColor === "b");
}
