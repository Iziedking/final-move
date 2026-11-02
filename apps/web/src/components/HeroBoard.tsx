"use client";
/**
 * The home page board. It shows a real game: a live one when someone is
 * playing (polled, so it moves in front of you), otherwise the latest finished
 * game replayed move by move with each move's real chain state. Nothing on it
 * is staged.
 */
import Link from "next/link";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { START_FEN } from "@final-move/chess";
import { PlayBoard } from "@/components/PlayBoard";
import { API_BASE } from "@/lib/api";
import { botName } from "@/lib/bots";
import { fetchNames } from "@/lib/names";
import type { ChainRailEntry } from "@/lib/types";

interface WatchRow { id: string; white_id: string; black_id: string; white_kind: string; black_kind: string; status: string; ply_count: number }
interface ReplayMove { ply: number; uci: string; fenAfter: string; state: string }
interface Replay { game: { id: string; whiteId: string; whiteKind: string; whiteName: string; blackId: string; blackKind: string; blackName: string }; moves: ReplayMove[] }

type Shown =
  | { mode: "live"; id: string; white: string; black: string; fen: string; lastUci?: string; ply: number }
  | { mode: "replay"; id: string; white: string; black: string; moves: ReplayMove[]; at: number }
  | { mode: "empty" };

function nameOf(id: string, kind: string, given?: string): string {
  if (kind === "bot") return botName(id) ?? "House bot";
  if (id.startsWith("guest")) return "Guest";
  const known = given && given !== id && given !== "Player" ? given : null;
  // Agents keep the name their owner chose; only X handles get an @.
  if (known) return kind === "agent" || known.startsWith("@") ? known : `@${known}`;
  return kind === "agent" ? "Agent" : "Player";
}

export function HeroBoard(): React.JSX.Element {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    const later = (fn: () => void, ms: number) => { timer.current = setTimeout(() => { if (alive) fn(); }, ms); };

    const pollLive = (row: WatchRow, white: string, black: string) => {
      fetch(`${API_BASE}/v1/games/${row.id}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ fen: string; moves: string[]; plyCount: number; status: string }>) : null))
        .then((g) => {
          if (!alive) return;
          if (!g || g.status === "ended" || g.status === "aborted") { later(pick, 2500); return; }
          setShown({ mode: "live", id: row.id, white, black, fen: g.fen, lastUci: g.moves[g.moves.length - 1], ply: g.plyCount });
          later(() => pollLive(row, white, black), 1500);
        })
        .catch(() => later(pick, 5000));
    };

    const playReplay = (rep: Replay) => {
      const moves = rep.moves.filter((m) => m.fenAfter);
      if (moves.length === 0) { setShown({ mode: "empty" }); return; }
      const white = nameOf(rep.game.whiteId, rep.game.whiteKind, rep.game.whiteName);
      const black = nameOf(rep.game.blackId, rep.game.blackKind, rep.game.blackName);
      let at = 0;
      const step = () => {
        setShown({ mode: "replay", id: rep.game.id, white, black, moves, at });
        if (at >= moves.length) { later(pick, 3500); return; }
        at += 1;
        later(step, 1100);
      };
      step();
    };

    async function pick() {
      try {
        const w = (await fetch(`${API_BASE}/v1/watch`).then((r) => r.json())) as { games?: WatchRow[] };
        const live = w.games?.find((g) => g.status === "live" && g.ply_count > 0);
        if (live) {
          const names = await fetchNames([live.white_id, live.black_id].filter((id) => !id.startsWith("bot_") && !id.startsWith("guest")));
          pollLive(
            live,
            nameOf(live.white_id, live.white_kind, names[live.white_id]?.name),
            nameOf(live.black_id, live.black_kind, names[live.black_id]?.name),
          );
          return;
        }
        const feed = (await fetch(`${API_BASE}/v1/feed/recent`).then((r) => r.json())) as { moves?: { gameId: string }[] };
        const recent = feed.moves?.[0]?.gameId;
        if (!recent) { if (alive) setShown({ mode: "empty" }); later(pick, 15_000); return; }
        const rep = (await fetch(`${API_BASE}/v1/games/${recent}/replay`).then((r) => r.json())) as Replay;
        if (alive) playReplay(rep);
      } catch {
        if (alive) setShown({ mode: "empty" });
        later(pick, 15_000);
      }
    }

    void pick();
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, []);

  let fen = START_FEN;
  let lastUci: string | undefined;
  let state: ChainRailEntry["state"] | undefined;
  if (shown?.mode === "live") { fen = shown.fen; lastUci = shown.lastUci; }
  if (shown?.mode === "replay" && shown.at > 0) {
    const m = shown.moves[shown.at - 1]!;
    fen = m.fenAfter; lastUci = m.uci;
    state = (["queued", "sent", "complete", "final"] as const).find((s) => s === m.state);
  }
  const turn = (fen.split(" ")[1] ?? "w") as "w" | "b";

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex min-h-[34px] items-center justify-between gap-2">
        {shown && shown.mode !== "empty" ? (
          <>
            <span
              className="chip"
              style={{ background: shown.mode === "live" ? "rgb(var(--mint))" : "rgb(var(--cyan))", color: "rgb(var(--candy-ink))" }}
            >
              <span className={`h-2 w-2 rounded-full ${shown.mode === "live" ? "animate-pulse" : ""}`} style={{ background: "rgb(var(--ink))" }} />
              {shown.mode === "live" ? "LIVE NOW" : "LATEST GAME"}
            </span>
            <span className="min-w-0 truncate text-[14px] font-extrabold" style={{ color: "rgb(var(--ink-2))" }}>
              {shown.white} <span style={{ color: "rgb(var(--ink-3))" }}>vs</span> {shown.black}
            </span>
          </>
        ) : (
          <span className="text-[14px] font-extrabold" style={{ color: "rgb(var(--ink-3))" }}>
            {shown ? "No games yet. Yours could be the first." : "Finding a game to show…"}
          </span>
        )}
      </div>

      <div className="pointer-events-none" aria-hidden={shown?.mode === "empty"}>
        <PlayBoard fen={fen} legalMoves={[]} myColor={null} turn={turn} lastUci={lastUci} onMove={() => {}} disabled lastMoveState={state} />
      </div>

      {shown && shown.mode !== "empty" && (
        <div className="flex items-center justify-between gap-2 text-[13px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>
          <span>
            {shown.mode === "live"
              ? `Move ${shown.ply}. Every one is a transaction on Arc.`
              : state === "final" ? `Move ${shown.at} of ${shown.moves.length}, final on Arc.` : `Move ${shown.at} of ${shown.moves.length}.`}
          </span>
          <Link
            href={shown.mode === "live" ? `/game/${shown.id}` : `/g/${shown.id}`}
            className="font-extrabold underline decoration-2 underline-offset-2"
            style={{ color: "rgb(var(--violet))" }}
          >
            {shown.mode === "live" ? "Watch" : "Replay"}
          </Link>
        </div>
      )}
    </div>
  );
}
