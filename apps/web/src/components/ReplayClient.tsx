"use client";
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import type React from "react";
import { useState, useCallback } from "react";
import { cx } from "@/lib/utils";

const ARC_EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER ?? "https://explorer.testnet.arc.io";

interface MoveRow {
  ply: number; uci: string; san: string | null; fenAfter: string;
  clockWMs: number; clockBMs: number; state: string;
  txHash: string | null; block: number | null; finalAt: string | null; relayed: boolean;
}

interface GameData {
  game: {
    id: string; whiteName: string; blackName: string; whiteAvatar: string | null;
    blackAvatar: string | null; result: string | null; reason: string | null;
    timeControl: string; chainGameId: string | null; endedAt: string | null;
    whiteAddress: string; blackAddress: string;
  };
  moves: MoveRow[];
  chainEvents: { eventName: string; args: Record<string, unknown>; txHash: string; blockNumber: number }[];
}

interface Props {
  gameId: string;
  initialData: GameData | null;
}

const RESULT_LABEL: Record<string, string> = {
  white: "White wins", black: "Black wins", draw: "Draw", aborted: "Aborted",
};

const REASON_LABEL: Record<string, string> = {
  checkmate: "by checkmate", resignation: "by resignation", timeout: "on time",
  abandon: "by abandonment", stalemate: "by stalemate", repetition: "by repetition",
  "fifty-move": "fifty-move rule", "insufficient-material": "insufficient material",
  agreement: "by agreement", aborted: "",
};

// State dot colour via inline style (avoids purge issues with dynamic class names)
function stateDotStyle(state: string): React.CSSProperties {
  if (state === "final")    return { background: "rgb(var(--mint))" };
  if (state === "complete") return { background: "rgb(var(--teal))" };
  if (state === "sent")     return { background: "rgb(var(--teal) / 0.6)" };
  return { background: "rgb(var(--ink) / 0.25)" };
}

function msToTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function ReplayClient({ gameId, initialData }: Props): React.JSX.Element {
  const [data, setData] = useState<GameData | null>(initialData);
  const [cursor, setCursor] = useState<number>(initialData?.moves.length ?? 0);
  const [loading, setLoading] = useState(false);
  const [shareText, setShareText] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/games/${gameId}/replay`);
      if (res.ok) { const d = await res.json() as GameData; setData(d); setCursor(d.moves.length); }
    } finally { setLoading(false); }
  }, [gameId]);

  const handleShare = useCallback(async () => {
    const res = await fetch(`${API_BASE}/v1/games/${gameId}/share`);
    if (res.ok) {
      const d = await res.json() as { xShareText: string };
      setShareText(d.xShareText);
      const url = encodeURIComponent(`https://finalmo.ve/g/${gameId}`);
      const text = encodeURIComponent(d.xShareText);
      window.open(`https://x.com/intent/tweet?url=${url}&text=${text}`, "_blank", "noopener");
    }
  }, [gameId]);

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4"
        style={{ background: "rgb(var(--sky))" }}>
        <div className="font-display text-2xl font-extrabold" style={{ color: "rgb(var(--ink))" }}>
          Final Move
        </div>
        <p className="text-sm font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
          Game not found or still in progress.
        </p>
        <button
          onClick={() => { void load(); }}
          disabled={loading}
          className="pop-btn rounded-2xl px-6 py-2 font-bold text-sm"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        <Link href="/" className="text-sm font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
          Back to home
        </Link>
      </div>
    );
  }

  const { game, moves } = data;
  const currentMove = moves[cursor - 1];
  const finalMoves = moves.filter((m) => m.state === "final").length;
  const resultLabel = game.result ? (RESULT_LABEL[game.result] ?? "Unknown") : "In progress";
  const reasonLabel = game.reason ? (REASON_LABEL[game.reason] ?? "") : "";

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "rgb(var(--sky))" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b-[3px]"
        style={{ background: "rgb(var(--cloud) / 0.9)", borderColor: "rgb(var(--ink) / 0.10)" }}>
        <Link href="/" className="font-display font-extrabold text-xl"
          style={{ color: "rgb(var(--ink))" }}>
          Final Move
        </Link>
        <span className="chip text-[10px]" style={{
          background: "rgb(var(--mint) / 0.15)",
          color: "rgb(var(--teal))",
          border: "1.5px solid rgb(var(--mint))",
        }}>
          Rebuilt from Arc
        </span>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 flex flex-col gap-4">

        {/* Result card */}
        <div className="sticker-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <span className="font-display font-extrabold text-base" style={{ color: "rgb(var(--ink))" }}>
                  {game.whiteName}
                </span>
                <span className="text-[10px] font-mono" style={{ color: "rgb(var(--ink-3))" }}>
                  {game.whiteAddress.slice(0, 10)}…
                </span>
              </div>
              <span className="text-sm font-bold" style={{ color: "rgb(var(--ink-3))" }}>vs</span>
              <div className="flex flex-col">
                <span className="font-display font-extrabold text-base" style={{ color: "rgb(var(--ink))" }}>
                  {game.blackName}
                </span>
                <span className="text-[10px] font-mono" style={{ color: "rgb(var(--ink-3))" }}>
                  {game.blackAddress.slice(0, 10)}…
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={cx(
                "font-display font-extrabold text-sm px-3 py-1 rounded-full border-2",
              )} style={
                game.result === "draw"
                  ? { borderColor: "rgb(var(--amber))", color: "rgb(var(--amber))", background: "rgb(var(--amber) / 0.10)" }
                  : game.result
                    ? { borderColor: "rgb(var(--mint))", color: "rgb(var(--teal))", background: "rgb(var(--mint) / 0.12)" }
                    : { borderColor: "rgb(var(--ink) / 0.2)", color: "rgb(var(--ink-2))", background: "rgb(var(--cloud-2))" }
              }>
                {resultLabel}
              </span>
              {reasonLabel && (
                <span className="text-[11px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
                  {reasonLabel}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-semibold flex-wrap"
            style={{ color: "rgb(var(--ink-3))" }}>
            <span>{game.timeControl}</span>
            <span style={{ color: "rgb(var(--teal))" }} className="font-bold">
              {finalMoves}/{moves.length} moves sealed on Arc
            </span>
            {game.endedAt && <span>{new Date(game.endedAt).toLocaleDateString()}</span>}
          </div>
        </div>

        {/* Scrubber */}
        <div className="sticker-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold font-display" style={{ color: "rgb(var(--ink))" }}>
              Move {cursor} / {moves.length}
            </span>
            <button
              onClick={() => setCursor(moves.length)}
              className="text-[11px] font-extrabold rounded-full px-3 py-1 border-2 transition-colors"
              style={{ borderColor: "rgb(var(--violet))", color: "rgb(var(--violet))", background: "rgb(var(--violet) / 0.06)" }}
            >
              Go to end
            </button>
          </div>
          <input
            type="range" min={0} max={moves.length} value={cursor}
            onChange={(e) => setCursor(Number(e.target.value))}
            className="w-full accent-[rgb(var(--teal))]"
            style={{ accentColor: "rgb(var(--teal))" }}
          />
          {currentMove && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-display font-extrabold" style={{ color: "rgb(var(--ink))" }}>
                {currentMove.san ?? currentMove.uci}
              </span>
              <span style={{ color: "rgb(var(--ink-3))" }}>·</span>
              <span className="font-mono text-xs" style={{ color: "rgb(var(--ink-2))" }}>
                {msToTime(currentMove.clockWMs)}W / {msToTime(currentMove.clockBMs)}B
              </span>
              {currentMove.txHash && (
                <a
                  href={`${ARC_EXPLORER}/tx/${currentMove.txHash}`}
                  target="_blank" rel="noopener noreferrer"
                  className="ml-auto text-[11px] font-mono font-bold hover:underline"
                  style={{ color: "rgb(var(--teal))" }}
                >
                  {currentMove.txHash.slice(0, 10)}… ↗
                </a>
              )}
            </div>
          )}
        </div>

        {/* Chain rail */}
        <div className="sticker-card p-5 flex flex-col gap-2 max-h-96 overflow-y-auto">
          <span className="font-display font-extrabold text-[11px] uppercase tracking-widest mb-1"
            style={{ color: "rgb(var(--ink-3))" }}>
            Chain rail
          </span>
          {moves.length === 0 && (
            <p className="text-sm font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
              No moves recorded.
            </p>
          )}
          {moves.slice().reverse().map((m) => (
            <div key={m.ply} className="flex items-center gap-2 py-1.5 px-2 rounded-xl text-xs transition-colors"
              style={cursor === m.ply
                ? { background: "rgb(var(--teal) / 0.10)", border: "1.5px solid rgb(var(--teal) / 0.3)" }
                : {}
              }>
              <span className="w-6 text-right font-mono font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
                {m.ply}.
              </span>
              <span className="font-display font-extrabold w-12" style={{ color: "rgb(var(--ink))" }}>
                {m.san ?? m.uci}
              </span>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={stateDotStyle(m.state)} />
              <span className="capitalize font-semibold" style={{ color: "rgb(var(--ink-2))" }}>
                {m.state}
              </span>
              {m.block && (
                <span className="font-mono ml-auto" style={{ color: "rgb(var(--ink-3))" }}>
                  #{m.block.toLocaleString()}
                </span>
              )}
              {m.txHash && (
                <a href={`${ARC_EXPLORER}/tx/${m.txHash}`} target="_blank" rel="noopener noreferrer"
                  className="font-mono font-bold hover:underline"
                  style={{ color: "rgb(var(--teal))" }}>
                  ↗
                </a>
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => { void handleShare(); }}
            className="flex-1 pop-btn rounded-2xl py-2.5 font-bold text-sm"
          >
            Share on X
          </button>
          {game.chainGameId && (
            <a
              href={`${ARC_EXPLORER}/search?q=${game.chainGameId}`}
              target="_blank" rel="noopener noreferrer"
              className="flex-1 pop-btn-ghost pop-btn rounded-2xl py-2.5 font-bold text-sm text-center"
            >
              Verify on Arc ↗
            </a>
          )}
          <button
            onClick={() => { void load(); }}
            disabled={loading}
            className="rounded-2xl border-2 px-4 py-2.5 text-sm font-bold transition-colors"
            style={{ borderColor: "rgb(var(--ink) / 0.15)", color: "rgb(var(--ink-2))", background: "rgb(var(--cloud))" }}
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>

        {shareText && (
          <p className="text-xs font-semibold italic" style={{ color: "rgb(var(--ink-3))" }}>
            &ldquo;{shareText}&rdquo;
          </p>
        )}
      </main>
    </div>
  );
}
