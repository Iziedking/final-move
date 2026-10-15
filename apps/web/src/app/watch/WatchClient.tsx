"use client";
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import type React from "react";
import { useState, useEffect } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

const SERVER = API_BASE;

interface GameRow {
  id:           string;
  white_id:     string;
  black_id:     string;
  white_kind:   string;
  black_kind:   string;
  time_control: string;
  status:       string;
  ply_count:    number;
  created_at:   string;
}

export function WatchClient(): React.JSX.Element {
  const [games, setGames]     = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => {
      fetch(`${SERVER}/v1/watch`)
        .then((r) => r.json())
        .then((d: { games: GameRow[] }) => { setGames(d.games ?? []); setLoading(false); })
        .catch(() => setLoading(false));
    };
    load();
    const iv = setInterval(load, 5_000);
    return () => clearInterval(iv);
  }, []);

  const kindLabel = (kind: string) => kind === "bot" ? "Bot" : kind === "agent" ? "Agent" : "Human";

  const statusStyle = (s: string) => ({
    background:  s === "live"  ? "rgb(var(--teal-light))"  : s === "ended" ? "rgb(var(--cloud-2))" : "rgb(var(--sky-2))",
    color:       s === "live"  ? "rgb(var(--teal-deep))"   : "rgb(var(--ink-3))",
    borderColor: s === "live"  ? "rgb(var(--teal))"        : "rgb(var(--ink) / 0.15)",
  });

  return (
    <div className="min-h-screen" style={{ background: "rgb(var(--sky))" }}>
      <header
        className="flex items-center justify-between px-4 py-3 border-b-2"
        style={{ background: "rgb(var(--cloud) / 0.85)", borderColor: "rgb(var(--ink) / 0.10)" }}
      >
        <Link href="/" className="font-display font-extrabold text-xl" style={{ color: "rgb(var(--ink))" }}>Final Move</Link>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold animate-pulse" style={{ color: "rgb(var(--teal))" }}>● Live</span>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        <h1 className="font-display text-2xl font-extrabold mb-1" style={{ color: "rgb(var(--ink))" }}>Watch</h1>
        <p className="text-sm font-medium mb-5" style={{ color: "rgb(var(--ink-2))" }}>Live and recent games. Click any to spectate.</p>

        {loading && (
          <div className="text-sm font-bold animate-pulse" style={{ color: "rgb(var(--ink-3))" }}>Loading games…</div>
        )}

        {!loading && games.length === 0 && (
          <div className="sticker-card p-8 text-center">
            <div className="w-12 h-12 rounded-full border-2 flex items-center justify-center font-display font-extrabold text-base mb-3 mx-auto" style={{ borderColor: "rgb(var(--ink))", background: "rgb(var(--cloud-2))", color: "rgb(var(--ink))" }}>—</div>
            <p className="text-sm font-semibold mb-4" style={{ color: "rgb(var(--ink-2))" }}>No live games right now.</p>
            <Link href="/" className="pop-btn inline-block rounded-2xl px-5 py-2 text-sm font-bold">Play one →</Link>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {games.map((g) => (
            <a
              key={g.id}
              href={`/game/${g.id}?spectate=1`}
              className="sticker-card-sm p-4 block transition-all hover:opacity-90 hover:-translate-y-px"
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="rounded-full border-2 px-2.5 py-0.5 text-[10px] font-extrabold"
                  style={statusStyle(g.status)}
                >
                  {g.status.toUpperCase()}
                </span>
                <span className="text-[11px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
                  {g.time_control} · {g.ply_count} plies
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="chip text-[10px]">{kindLabel(g.white_kind)}</span>
                <span className="text-[13px] font-bold font-display flex-1 truncate" style={{ color: "rgb(var(--ink))" }}>{g.white_id}</span>
                <span className="text-[11px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>vs</span>
                <span className="text-[13px] font-bold font-display flex-1 truncate text-right" style={{ color: "rgb(var(--ink))" }}>{g.black_id}</span>
                <span className="chip text-[10px]">{kindLabel(g.black_kind)}</span>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
