"use client";
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import React, { useState, useEffect, useCallback } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

interface BracketMatch { round: number; index: number; a: number | null; b: number | null; winner: number | null; }
interface Bracket { size: number; rounds: BracketMatch[][]; }
interface TournamentEntry { playerId: string; playerKind: string; placement: number | null; prizeUsdc6: string; }
interface TournamentMatch { game_id: string; round: number; match_index: number; white_player_id: string; black_player_id: string; winner_id: string | null; }
interface Tournament { id: string; name: string; class: string; status: string; timeControl: string; prizePoolUsdc6: string; regClose: string; startsAt: string; entries: TournamentEntry[]; games: TournamentMatch[]; bracket: Bracket | null; }

const API = API_BASE;
const prizeDisplay = (usdc6: string) => (Number(usdc6) / 1_000_000).toFixed(2);

function useCountdown(target: string | undefined) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!target) return;
    const tick = () => {
      const ms = new Date(target).getTime() - Date.now();
      if (ms <= 0) { setText("Registration closed"); return; }
      const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1_000);
      setText(`${h}h ${m}m ${s}s`);
    };
    tick(); const id = setInterval(tick, 1_000); return () => clearInterval(id);
  }, [target]);
  return text;
}

function MatchCard({ match, entries }: { match: BracketMatch; entries: TournamentEntry[] }) {
  const nameA = match.a !== null ? (entries[match.a]?.playerId ?? `#${match.a}`) : "BYE";
  const nameB = match.b !== null ? (entries[match.b]?.playerId ?? `#${match.b}`) : "BYE";
  const champA = match.winner === match.a && match.a !== null;
  const champB = match.winner === match.b && match.b !== null;
  return (
    <div className="sticker-card-sm overflow-hidden min-w-[140px] p-0">
      <div className="px-3 py-1.5 text-xs mono truncate border-b-2" style={{ borderColor: "rgb(var(--ink) / 0.10)", background: champA ? "rgb(var(--amber) / 0.15)" : "rgb(var(--cloud-2))", color: champA ? "rgb(var(--amber))" : "rgb(var(--ink-2))" }}>
        {champA && "★ "}{nameA}
      </div>
      <div className="px-3 py-1.5 text-xs mono truncate" style={{ background: champB ? "rgb(var(--amber) / 0.15)" : "rgb(var(--cloud))", color: champB ? "rgb(var(--amber))" : "rgb(var(--ink-2))" }}>
        {champB && "★ "}{nameB}
      </div>
    </div>
  );
}

function BracketView({ bracket, entries }: { bracket: Bracket; entries: TournamentEntry[] }) {
  const roundNames = bracket.rounds.map((_: BracketMatch[], i: number) => {
    const r = bracket.rounds.length - i;
    return r === 1 ? "Final" : r === 2 ? "Semi-final" : r === 3 ? "Quarter-final" : `Round ${i + 1}`;
  });
  return (
    <div className="flex gap-6 overflow-x-auto pb-4">
      {bracket.rounds.map((round: BracketMatch[], ri: number) => (
        <div key={ri} className="flex flex-col gap-4 items-start">
          <div className="text-[11px] font-extrabold uppercase tracking-widest font-display mb-1" style={{ color: "rgb(var(--ink-3))" }}>{roundNames[ri]}</div>
          <div className="flex flex-col gap-5 justify-around flex-1">
            {round.map((match: BracketMatch) => <MatchCard key={`${ri}-${match.index}`} match={match} entries={entries} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CupClient(): React.JSX.Element {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selected, setSelected]       = useState<Tournament | null>(null);
  const [loading, setLoading]         = useState(true);
  const countdown = useCountdown(selected?.regClose);

  const fetchList = useCallback(async () => {
    try { const res = await fetch(`${API}/v1/tournaments`); const d = await res.json() as { tournaments: Tournament[] }; setTournaments(d.tournaments ?? []); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  const fetchOne = useCallback(async (id: string) => {
    try { const res = await fetch(`${API}/v1/tournaments/${id}`); if (res.ok) setSelected(await res.json() as Tournament); }
    catch { /* ignore */ }
  }, []);

  useEffect(() => { void fetchList(); const id = setInterval(() => void fetchList(), 10_000); return () => clearInterval(id); }, [fetchList]);
  useEffect(() => { if (!selected) return; void fetchOne(selected.id); const id = setInterval(() => void fetchOne(selected.id), 5_000); return () => clearInterval(id); }, [selected?.id, fetchOne]);

  const champion = selected?.entries.find((e) => e.placement === 1);

  const statusStyle = (s: string): React.CSSProperties => ({
    background:  s === "running" ? "rgb(var(--teal-light))" : s === "done" ? "rgb(var(--cloud-2))" : s === "open" ? "rgb(var(--sky-blue) / 0.15)" : "rgb(var(--cloud-2))",
    color:       s === "running" ? "rgb(var(--teal-deep))"  : s === "done" ? "rgb(var(--ink-3))"   : s === "open" ? "rgb(var(--sky-blue))"          : "rgb(var(--ink-3))",
    borderColor: s === "running" ? "rgb(var(--teal))"       : "rgb(var(--ink) / 0.15)",
  });

  return (
    <div className="min-h-screen" style={{ background: "rgb(var(--sky))" }}>
      <header className="flex items-center justify-between px-4 py-3 border-b-2" style={{ background: "rgb(var(--cloud) / 0.85)", borderColor: "rgb(var(--ink) / 0.10)" }}>
        <Link href="/" className="font-display font-extrabold text-xl" style={{ color: "rgb(var(--ink))" }}>Final Move</Link>
        <ThemeToggle />
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="font-display text-3xl font-extrabold mb-1" style={{ color: "rgb(var(--ink))" }}>Saturday Cup</h1>
        <p className="font-medium mb-6" style={{ color: "rgb(var(--ink-2))" }}>Weekly single-elimination tournament · prize funded by the sponsor</p>

        {loading ? (
          <div className="text-sm font-bold animate-pulse" style={{ color: "rgb(var(--ink-3))" }}>Loading tournaments…</div>
        ) : tournaments.length === 0 ? (
          <div className="sticker-card p-8 text-center">
            <p className="font-medium" style={{ color: "rgb(var(--ink-2))" }}>No tournaments scheduled yet. Check back on Saturday.</p>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mb-8">
            {tournaments.map((t) => (
              <button key={t.id} onClick={() => setSelected(t)}
                className="sticker-card p-4 text-left transition-all hover:-translate-y-px hover:opacity-90"
                style={{ borderColor: selected?.id === t.id ? "rgb(var(--teal))" : "rgb(var(--ink))", background: selected?.id === t.id ? "rgb(var(--teal-light))" : "rgb(var(--cloud))" }}
              >
                <div className="font-extrabold font-display text-sm truncate" style={{ color: "rgb(var(--ink))" }}>{t.name}</div>
                <div className="text-xs font-semibold mt-1" style={{ color: "rgb(var(--ink-3))" }}>{t.timeControl} · {t.entries?.length ?? 0} players</div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="rounded-full border-2 px-2.5 py-0.5 text-[10px] font-extrabold" style={statusStyle(t.status)}>{t.status}</span>
                  {Number(t.prizePoolUsdc6) > 0 && <span className="text-xs font-extrabold" style={{ color: "rgb(var(--amber))" }}>{prizeDisplay(t.prizePoolUsdc6)} USDC</span>}
                </div>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="sticker-card-lg p-6 flex flex-col gap-6">
            {/* Title + countdown */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-extrabold" style={{ color: "rgb(var(--ink))" }}>{selected.name}</h2>
                <div className="text-sm font-semibold mt-0.5" style={{ color: "rgb(var(--ink-2))" }}>{selected.timeControl} · {selected.class} class</div>
              </div>
              {selected.status === "open" && (
                <div className="sticker-card-sm px-4 py-2 text-sm text-center">
                  <div className="text-xs font-bold mb-0.5" style={{ color: "rgb(var(--ink-3))" }}>Registration closes in</div>
                  <div className="mono font-extrabold" style={{ color: "rgb(var(--amber))" }}>{countdown}</div>
                </div>
              )}
            </div>

            {/* Champion */}
            {selected.status === "done" && champion && (
              <div className="sticker-card p-6 text-center" style={{ background: "rgb(var(--amber) / 0.12)", borderColor: "rgb(var(--amber))" }}>
                <div className="w-12 h-12 rounded-full border-2 flex items-center justify-center font-display font-extrabold text-xs mb-2 mx-auto" style={{ borderColor: "rgb(var(--ink))", background: "rgb(var(--amber))", color: "rgb(var(--ink))" }}>1st</div>
                <div className="font-display font-extrabold text-lg" style={{ color: "rgb(var(--ink))" }}>{champion.playerId}</div>
                <div className="text-sm font-semibold mt-1" style={{ color: "rgb(var(--ink-2))" }}>Champion · {prizeDisplay(champion.prizeUsdc6)} USDC</div>
              </div>
            )}

            {/* Bracket */}
            {selected.bracket && (
              <div>
                <h3 className="text-[11px] font-extrabold uppercase tracking-widest font-display mb-3" style={{ color: "rgb(var(--ink-3))" }}>Bracket</h3>
                <BracketView bracket={selected.bracket} entries={selected.entries} />
              </div>
            )}

            {/* Standings */}
            {selected.entries.length > 0 && (
              <div>
                <h3 className="text-[11px] font-extrabold uppercase tracking-widest font-display mb-3" style={{ color: "rgb(var(--ink-3))" }}>
                  {selected.status === "done" ? "Final standings" : "Registered players"}
                </h3>
                <div className="flex flex-col gap-1">
                  {selected.entries.sort((a, b) => (a.placement ?? 999) - (b.placement ?? 999)).map((e) => (
                    <div key={e.playerId} className="flex items-center justify-between rounded-2xl px-3 py-2" style={{ background: "rgb(var(--cloud-2))" }}>
                      <div className="flex items-center gap-2">
                        {e.placement === 1 && <span>🥇</span>}
                        {e.placement === 2 && <span>🥈</span>}
                        {e.placement === 3 && <span>🥉</span>}
                        {e.placement !== null && e.placement > 3 && <span className="text-xs font-semibold" style={{ color: "rgb(var(--ink-3))" }}>#{e.placement}</span>}
                        {e.placement === null && <span className="text-xs font-semibold" style={{ color: "rgb(var(--ink-3))" }}>—</span>}
                        <span className="text-sm mono font-semibold" style={{ color: "rgb(var(--ink))" }}>{e.playerId}</span>
                        <span className="text-xs" style={{ color: "rgb(var(--ink-3))" }}>{e.playerKind}</span>
                      </div>
                      {Number(e.prizeUsdc6) > 0 && <span className="text-sm font-extrabold" style={{ color: "rgb(var(--amber))" }}>+{prizeDisplay(e.prizeUsdc6)} USDC</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Games */}
            {selected.games.length > 0 && (
              <div>
                <h3 className="text-[11px] font-extrabold uppercase tracking-widest font-display mb-3" style={{ color: "rgb(var(--ink-3))" }}>Games</h3>
                <div className="flex flex-col gap-1">
                  {selected.games.map((g) => (
                    <Link key={g.game_id} href={`/game/${g.game_id}`}
                      className="flex items-center justify-between rounded-2xl px-3 py-2 transition-colors hover:opacity-80"
                      style={{ background: "rgb(var(--cloud-2))" }}
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-xs font-semibold" style={{ color: "rgb(var(--ink-3))" }}>R{g.round + 1}M{g.match_index + 1}</span>
                        <span className="font-semibold" style={{ color: g.winner_id === g.white_player_id ? "rgb(var(--amber))" : "rgb(var(--ink))" }}>{g.white_player_id}</span>
                        <span className="font-semibold" style={{ color: "rgb(var(--ink-3))" }}>vs</span>
                        <span className="font-semibold" style={{ color: g.winner_id === g.black_player_id ? "rgb(var(--amber))" : "rgb(var(--ink))" }}>{g.black_player_id}</span>
                      </div>
                      {g.winner_id
                        ? <span className="text-xs font-semibold" style={{ color: "rgb(var(--ink-3))" }}>done</span>
                        : <span className="text-xs font-extrabold animate-pulse" style={{ color: "rgb(var(--teal))" }}>live</span>
                      }
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
