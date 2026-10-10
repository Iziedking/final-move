"use client";
/**
 * Game screen: board, bars, clocks, move list, chain rail, end screen.
 * Connects via WS to the server game room.
 */
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useGameWs } from "@/lib/useGameWs";
import { PlayBoard } from "@/components/PlayBoard";
import { PlayerBar } from "@/components/PlayerBar";
import { Clock } from "@/components/Clock";
import { ChainRail } from "@/components/ChainRail";
import { explorerTx, cx } from "@/lib/utils";
import type { PlayerInfo } from "@/lib/types";

// Placeholder legal moves fetch — the server sends the full game_state with legalMoves
// We just keep them from the last state update
interface Props {
  gameId: string;
  /** Injected by the Play page when creating a guest game */
  playerId?: string;
  myColor?: "w" | "b";
}

export function GameClient({ gameId, playerId: injectedPlayerId, myColor: injectedColor }: Props) {
  const { data: session } = useSession();
  const playerId = injectedPlayerId ?? session?.user?.id ?? "guest";
  const router = useRouter();

  const { connected, gameState, chainRail, sendMove, drawOfferedBy, ratingDelta, rematchGameId } = useGameWs(gameId, playerId);
  const [legalMoves, setLegalMoves]   = useState<string[]>([]);
  const [flipped, setFlipped]         = useState(false);
  const [showRail, setShowRail]       = useState(false);
  const [drawSent, setDrawSent]       = useState(false);
  const [rematchLoading, setRematchLoading] = useState(false);
  const moveListRef = useRef<HTMLDivElement>(null);

  // Fetch legal moves from server REST when position changes
  useEffect(() => {
    if (!gameState || gameState.status !== "live") return;
    const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
    fetch(`${serverUrl}/v1/games/${gameId}`)
      .then((r) => r.json())
      .then((data: { legalMoves?: string[] }) => setLegalMoves(data.legalMoves ?? []))
      .catch(() => {});
  }, [gameId, gameState?.fen, gameState?.status]);

  // Scroll move list to bottom
  useEffect(() => {
    if (moveListRef.current) {
      moveListRef.current.scrollTop = moveListRef.current.scrollHeight;
    }
  }, [gameState?.moves]);

  if (!gameState && !connected) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sky">
        <div className="font-display text-lg text-ink-3 animate-pulse">Connecting…</div>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sky">
        <div className="font-display text-lg text-ink-3">Loading game…</div>
      </div>
    );
  }

  const gs = gameState;
  const myColor = injectedColor ?? (gs.white.id === playerId ? "w" : gs.black.id === playerId ? "b" : null);
  const turn = gs.turn;
  const iAmOnMove = myColor === turn && gs.status === "live";
  const ended = gs.status === "ended" || gs.status === "aborted";
  const lastUci = gs.moves[gs.moves.length - 1];

  // Build player info with online status
  const topPlayer: PlayerInfo    = flipped ? gs.white : gs.black;
  const bottomPlayer: PlayerInfo = flipped ? gs.black : gs.white;
  const topActive   = turn === topPlayer.color;
  const bottomActive = turn === bottomPlayer.color;
  const topMs   = topPlayer.color === "w" ? gs.clockWMs : gs.clockBMs;
  const bottomMs = bottomPlayer.color === "w" ? gs.clockWMs : gs.clockBMs;

  return (
    <div className="flex min-h-screen flex-col bg-sky">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b-[3px] border-ink bg-cloud shadow-pop-press">
        <a href="/" className="font-display font-bold text-ink text-lg">Final Move</a>
        <div className="flex items-center gap-2">
          <span className={cx(
            "h-2 w-2 rounded-full border border-ink",
            connected ? "bg-mint" : "bg-coral",
          )} />
          <button
            onClick={() => setShowRail((v) => !v)}
            className="rounded-pill border-[2px] border-ink bg-cyan px-3 py-1 text-[11px] font-bold text-ink shadow-pop-press hover:bg-cyan/80 transition-colors"
          >
            Chain rail
          </button>
          <button
            onClick={() => setFlipped((v) => !v)}
            className="rounded-pill border-[2px] border-ink bg-cloud-2 px-3 py-1 text-[11px] font-bold text-ink shadow-pop-press hover:bg-cloud transition-colors"
          >
            Flip
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center gap-3 px-4 py-4 max-w-lg mx-auto w-full">

        {/* Top player bar + clock */}
        <div className="flex w-full items-center gap-2">
          <div className="flex-1"><PlayerBar player={topPlayer} active={topActive} /></div>
          <Clock ms={topMs} running={topActive && gs.status === "live"} />
        </div>

        {/* Board */}
        <div className="w-full">
          <PlayBoard
            fen={gs.fen}
            legalMoves={iAmOnMove ? legalMoves : []}
            myColor={myColor}
            turn={turn}
            lastUci={lastUci}
            flipped={flipped}
            onMove={sendMove}
            disabled={!iAmOnMove || ended}
          />
        </div>

        {/* Bottom player bar + clock */}
        <div className="flex w-full items-center gap-2">
          <div className="flex-1"><PlayerBar player={bottomPlayer} active={bottomActive} /></div>
          <Clock ms={bottomMs} running={bottomActive && gs.status === "live"} />
        </div>

        {/* Chain rail (mobile collapsible bottom sheet) */}
        {showRail && (
          <div className="w-full rounded-chunk border-[3px] border-ink bg-cloud p-3 shadow-pop">
            <ChainRail entries={chainRail} />
          </div>
        )}

        {/* Move list */}
        {gs.moves.length > 0 && (
          <div
            ref={moveListRef}
            className="w-full rounded-chunk border-[3px] border-ink bg-cloud p-3 shadow-pop max-h-28 overflow-y-auto"
          >
            <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[12px] text-ink-2">
              {gs.moves.map((uci, i) => (
                <span key={i}>
                  {i % 2 === 0 && (
                    <span className="text-ink-3 mr-0.5">{Math.floor(i / 2) + 1}.</span>
                  )}
                  <span>{uci}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* End screen overlay */}
        {ended && (
          <EndScreen
            result={gs.result}
            reason={gs.reason}
            myColor={myColor}
            explorerHash={chainRail.find((e) => e.state === "final")?.txHash}
            plyCount={gs.plyCount}
          />
        )}

        {/* Draw offered banner */}
        {drawOfferedBy && drawOfferedBy !== playerId && !ended && (
          <div className="w-full rounded-chunk border-[3px] border-amber bg-amber/10 p-3 flex items-center justify-between gap-3">
            <span className="font-body text-sm text-ink">Opponent offers a draw</span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
                  fetch(`${serverUrl}/v1/games/${gameId}/draw-offer`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ playerId }),
                  }).catch(() => {});
                }}
                className="rounded-pill border-[2px] border-ink bg-mint px-3 py-1 font-body font-bold text-[12px] text-ink shadow-pop-press"
              >Accept</button>
              <button
                onClick={() => {/* decline — just ignore */}}
                className="rounded-pill border-[2px] border-ink bg-cloud-2 px-3 py-1 font-body font-bold text-[12px] text-ink shadow-pop-press"
              >Decline</button>
            </div>
          </div>
        )}

        {/* Rematch auto-navigate */}
        {rematchGameId && (
          <div className="w-full rounded-chunk border-[3px] border-mint bg-mint/10 p-3 flex items-center justify-between gap-3">
            <span className="font-body text-sm text-ink">Rematch accepted!</span>
            <button
              onClick={() => router.push(`/game/${rematchGameId}?pid=${playerId}`)}
              className="rounded-pill border-[2px] border-ink bg-violet px-3 py-1 font-body font-bold text-[12px] text-cloud shadow-pop"
            >Go →</button>
          </div>
        )}

        {/* Resign / draw / rematch actions */}
        {!ended && gs.status === "live" && myColor && (
          <div className="flex gap-2 w-full">
            <button
              onClick={() => {
                if (confirm("Resign this game?")) {
                  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
                  fetch(`${serverUrl}/v1/games/${gameId}/resign`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ playerId }),
                  }).catch(() => {});
                }
              }}
              className="flex-1 rounded-chunk border-[3px] border-ink bg-coral px-3 py-2 font-body font-bold text-sm text-cloud shadow-pop hover:shadow-pop-press transition-all"
            >
              Resign
            </button>
            <button
              disabled={drawSent}
              onClick={() => {
                setDrawSent(true);
                const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
                fetch(`${serverUrl}/v1/games/${gameId}/draw-offer`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ playerId }),
                }).catch(() => {});
              }}
              className={cx(
                "flex-1 rounded-chunk border-[3px] border-ink px-3 py-2 font-body font-bold text-sm shadow-pop transition-all",
                drawSent ? "bg-cloud-2 text-ink-3 cursor-not-allowed" : "bg-cyan text-ink hover:shadow-pop-press",
              )}
            >
              {drawSent ? "Draw offered" : "Offer draw"}
            </button>
          </div>
        )}

        {/* Rating delta (shown after game ends) */}
        {ended && ratingDelta && myColor && (
          <div className="w-full rounded-chunk border-[3px] border-ink bg-cloud p-3 flex items-center justify-center gap-4 shadow-pop">
            {[
              { label: "White", delta: ratingDelta.white },
              { label: "Black", delta: ratingDelta.black },
            ].map(({ label, delta }) => (
              <div key={label} className="text-center">
                <div className="font-body text-[11px] text-ink-3">{label}</div>
                <div className={cx(
                  "font-display font-bold text-lg",
                  delta > 0 ? "text-mint" : delta < 0 ? "text-coral" : "text-ink-2",
                )}>
                  {delta > 0 ? "+" : ""}{delta.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Rematch button (post-game, vs human only) */}
        {ended && gs.white.kind !== "bot" && gs.black.kind !== "bot" && (
          <button
            disabled={rematchLoading}
            onClick={async () => {
              setRematchLoading(true);
              const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
              await fetch(`${serverUrl}/v1/games/${gameId}/rematch`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerId }),
              }).catch(() => {});
              setRematchLoading(false);
            }}
            className="w-full rounded-chunk border-[3px] border-ink bg-violet py-3 font-display font-bold text-cloud shadow-pop hover:shadow-pop-press transition-all"
          >
            {rematchLoading ? "Sending…" : "Rematch"}
          </button>
        )}
      </main>
    </div>
  );
}

function EndScreen({
  result, reason, myColor, explorerHash, plyCount,
}: {
  result?: string;
  reason?: string;
  myColor: "w" | "b" | null;
  explorerHash?: string;
  plyCount: number;
}): React.JSX.Element {
  const won   = (result === "white" && myColor === "w") || (result === "black" && myColor === "b");
  const drew  = result === "draw";
  const lost  = !won && !drew && result !== "aborted";

  const label = result === "aborted" ? "Aborted"
    : drew  ? "Draw"
    : won   ? "You won!"
    : lost  ? "You lost"
    : result === "white" ? "White wins" : "Black wins";

  const bg = result === "aborted" ? "bg-ink-3"
    : drew   ? "bg-cyan"
    : won    ? "bg-mint"
    : "bg-coral";

  return (
    <div className="w-full rounded-chunk border-[3px] border-ink bg-cloud p-5 shadow-pop-lg text-center">
      {/* Result stamp */}
      <div className={cx(
        "inline-block rounded-chunk border-[3px] border-ink px-6 py-2 font-display text-2xl font-bold text-ink shadow-pop mb-3",
        bg,
      )}>
        {label}
      </div>

      {reason && (
        <p className="font-body text-sm text-ink-2 mb-3 capitalize">{reason.replace("-", " ")}</p>
      )}

      <p className="font-body text-sm text-ink-2 mb-4">
        This game was <strong>{plyCount} moves on Arc.</strong>{" "}
        Every one is final. Verify it.
      </p>

      {/* Explorer link */}
      {explorerHash && (
        <a
          href={explorerTx(explorerHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded-chunk border-[3px] border-ink bg-violet px-4 py-2 font-body font-bold text-cloud shadow-pop hover:shadow-pop-press transition-all mb-4"
        >
          View on Arc Explorer →
        </a>
      )}

      <div className="flex gap-3 justify-center">
        <a
          href="/"
          className="rounded-chunk border-[3px] border-ink bg-cloud-2 px-4 py-2 font-body font-bold text-ink shadow-pop hover:shadow-pop-press transition-all"
        >
          Home
        </a>
      </div>
    </div>
  );
}
