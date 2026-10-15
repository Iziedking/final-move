"use client";
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import type React from "react";
import { useState, useCallback } from "react";
import { cx } from "@/lib/utils";

const API = API_BASE;
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

const STATE_DOT: Record<string, string> = {
  queued: "bg-ink-3", sent: "bg-cyan", complete: "bg-cyan", final: "bg-fm-success/20",
};

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
      const res = await fetch(`${API}/v1/games/${gameId}/replay`);
      if (res.ok) { const d = await res.json() as GameData; setData(d); setCursor(d.moves.length); }
    } finally { setLoading(false); }
  }, [gameId]);

  const handleShare = useCallback(async () => {
    const res = await fetch(`${API}/v1/games/${gameId}/share`);
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
      <div className="min-h-screen bg-fm-canvas flex flex-col items-center justify-center gap-4 px-4">
        <div className="text-fm-ink font-display text-2xl font-bold">Final Move Replay</div>
        <p className="text-fm-ink2 text-sm text-sm">Game not found or still in progress.</p>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-full border border-fm-ink/20 bg-fm-green px-6 py-2 font-bold text-white  hover: transition-all"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
    );
  }

  const { game, moves } = data;
  const currentMove = moves[cursor - 1];
  const finalMoves = moves.filter((m) => m.state === "final").length;
  const resultLabel = game.result ? RESULT_LABEL[game.result] : "In progress";
  const reasonLabel = game.reason ? REASON_LABEL[game.reason] ?? "" : "";

  return (
    <div className="min-h-screen bg-fm-canvas flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b-[3px] border-fm-ink/20 bg-fm-surface ">
        <Link href="/" className="font-display font-bold text-xl text-fm-ink">Final Move</Link>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-fm-success bg-fm-success/20/10 px-2 py-1 rounded-full border border-mint">
            Rebuilt from Arc
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 flex flex-col gap-4">
        {/* Result card */}
        <div className="rounded-xl border border-fm-ink/20 bg-fm-surface p-4  flex flex-col gap-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <span className="font-display font-bold text-lg text-fm-ink">{game.whiteName}</span>
                <span className="text-xs text-fm-ink3 font-mono">{game.whiteAddress.slice(0, 10)}…</span>
              </div>
              <span className="text-sm text-fm-ink2 font-bold">vs</span>
              <div className="flex flex-col">
                <span className="font-display font-bold text-lg text-fm-ink">{game.blackName}</span>
                <span className="text-xs text-fm-ink3 font-mono">{game.blackAddress.slice(0, 10)}…</span>
              </div>
            </div>
            <div className="flex flex-col items-end">
              <span className={cx(
                "font-display font-bold text-base px-3 py-1 rounded-full border",
                game.result === "draw" ? "border-amber text-amber bg-amber/10"
                : game.result ? "border-mint text-fm-success bg-fm-success/20/10"
                : "border-fm-ink/20-3 text-fm-ink2 bg-fm-surface2",
              )}>
                {resultLabel}
              </span>
              {reasonLabel && <span className="text-xs text-fm-ink3 mt-1">{reasonLabel}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-fm-ink3 flex-wrap">
            <span>{game.timeControl} · {game.whiteAddress.slice(0, 6)}…</span>
            <span className="text-fm-success font-bold">{finalMoves}/{moves.length} final on Arc</span>
            {game.endedAt && <span>{new Date(game.endedAt).toLocaleDateString()}</span>}
          </div>
        </div>

        {/* Scrubber */}
        <div className="rounded-xl border border-fm-ink/20 bg-fm-surface p-4  flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-fm-ink text-sm">Move {cursor} / {moves.length}</span>
            <button
              onClick={() => setCursor(moves.length)}
              className="text-xs text-fm-green font-bold border border-violet rounded-full px-3 py-1 hover:bg-fm-green/10"
            >
              Go to end
            </button>
          </div>
          <input
            type="range" min={0} max={moves.length} value={cursor}
            onChange={(e) => setCursor(Number(e.target.value))}
            className="w-full accent-violet"
          />
          {currentMove && (
            <div className="text-sm font-mono text-fm-ink2 flex items-center gap-2">
              <span className="font-bold text-fm-ink">{currentMove.san ?? currentMove.uci}</span>
              <span>·</span>
              <span>{msToTime(currentMove.clockWMs)}W / {msToTime(currentMove.clockBMs)}B</span>
              {currentMove.txHash && (
                <a
                  href={`${ARC_EXPLORER}/tx/${currentMove.txHash}`}
                  target="_blank" rel="noopener"
                  className="text-fm-success hover:underline ml-auto text-xs"
                >
                  {currentMove.txHash.slice(0, 10)}… ↗
                </a>
              )}
            </div>
          )}
        </div>

        {/* Chain rail */}
        <div className="rounded-xl border border-fm-ink/20 bg-fm-surface p-4  flex flex-col gap-2 max-h-96 overflow-y-auto">
          <span className="font-display font-bold text-sm text-fm-ink mb-1">Chain rail</span>
          {moves.length === 0 && (
            <p className="text-sm text-fm-ink3">No moves recorded.</p>
          )}
          {moves.slice().reverse().map((m) => (
            <div key={m.ply} className={cx(
              "flex items-center gap-2 py-1 px-2 rounded-lg text-xs",
              cursor === m.ply ? "bg-fm-green/10 border border-violet/30" : "",
            )}>
              <span className="w-6 text-right text-fm-ink3 font-mono">{m.ply}.</span>
              <span className="font-bold font-mono text-fm-ink w-12">{m.san ?? m.uci}</span>
              <span className={cx("w-2 h-2 rounded-full flex-shrink-0", STATE_DOT[m.state] ?? "bg-ink-3")} />
              <span className="text-fm-ink2 capitalize">{m.state}</span>
              {m.block && <span className="text-fm-ink3 font-mono ml-auto">#{m.block.toLocaleString()}</span>}
              {m.txHash && (
                <a href={`${ARC_EXPLORER}/tx/${m.txHash}`} target="_blank" rel="noopener"
                   className="text-cyan hover:underline font-mono">
                  ↗
                </a>
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleShare}
            className="flex-1 rounded-full border border-fm-ink/20 bg-fm-green px-4 py-2 font-bold text-white  hover: transition-all text-sm"
          >
            Share on X
          </button>
          {game.chainGameId && (
            <a
              href={`${ARC_EXPLORER}/search?q=${game.chainGameId}`}
              target="_blank" rel="noopener"
              className="flex-1 rounded-full border border-fm-ink/20 bg-fm-surface px-4 py-2 font-bold text-fm-ink  hover: transition-all text-sm text-center"
            >
              Verify on Arc ↗
            </a>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="rounded-full border border-fm-ink/20-3 bg-fm-surface2 px-4 py-2 text-sm text-fm-ink2 text-sm hover:bg-fm-surface"
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>

        {shareText && (
          <p className="text-xs text-fm-ink3 italic">&ldquo;{shareText}&rdquo;</p>
        )}
      </main>
    </div>
  );
}
