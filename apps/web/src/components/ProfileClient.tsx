"use client";
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import type React from "react";
import { useState, useCallback } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

const API = API_BASE;

interface RatingRow { class: string; timeControl: string; mu: number; sigma: number; games: number; conservative: number; }
interface StreakRow  { class: string; current_streak: number; best_streak: number; }
interface TitleRow  { title: string; earnedAt: string; }
interface GameRow   { id: string; whiteId: string; blackId: string; result: string | null; timeControl: string; class: string; createdAt: string; playerColor: "w" | "b"; playerResult: "win" | "loss" | "draw" | "aborted"; }
interface ProfileData {
  profile: { id: string; kind: string; name: string; avatar?: string | null; createdAt: string | null };
  stats:   { wins: number; draws: number; losses: number; total: number };
  ratings: RatingRow[];
  streaks: StreakRow[];
  titles:  TitleRow[];
  recentGames: GameRow[];
}

const RESULT_STYLE: Record<string, React.CSSProperties> = {
  win:     { color: "rgb(var(--teal))",    borderColor: "rgb(var(--teal))",    background: "rgb(var(--teal-light))" },
  loss:    { color: "rgb(var(--danger))",  borderColor: "rgb(var(--danger))",  background: "rgb(var(--danger) / 0.10)" },
  draw:    { color: "rgb(var(--amber))",   borderColor: "rgb(var(--amber))",   background: "rgb(var(--amber) / 0.12)" },
  aborted: { color: "rgb(var(--ink-3))",   borderColor: "rgb(var(--ink-3))",   background: "rgb(var(--cloud-2))" },
};

export function ProfileClient({ playerId, initialData }: { playerId: string; initialData: ProfileData | null }): React.JSX.Element {
  const [data, setData]     = useState<ProfileData | null>(initialData);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await fetch(`${API}/v1/profile/${playerId}`); if (res.ok) setData(await res.json() as ProfileData); }
    finally { setLoading(false); }
  }, [playerId]);

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen" style={{ background: "rgb(var(--sky))" }}>
      <header className="flex items-center justify-between px-4 py-3 border-b-2" style={{ background: "rgb(var(--cloud) / 0.85)", borderColor: "rgb(var(--ink) / 0.10)" }}>
        <Link href="/" className="font-display font-extrabold text-xl" style={{ color: "rgb(var(--ink))" }}>Final Move</Link>
        <ThemeToggle />
      </header>
      <main className="max-w-xl mx-auto w-full px-4 py-6 flex flex-col gap-4">{children}</main>
    </div>
  );

  if (!data) return shell(
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="font-display text-2xl font-extrabold" style={{ color: "rgb(var(--ink))" }}>Profile</div>
      <button onClick={() => { void load(); }} disabled={loading} className="pop-btn rounded-full px-6 py-2 font-bold">
        {loading ? "Loading…" : "Load profile"}
      </button>
    </div>
  );

  const { profile, stats, ratings, streaks, titles, recentGames } = data;
  const openRating = ratings.find((r) => r.class === "open" && r.timeControl === "5+3");

  return shell(
    <>
      {/* Identity */}
      <div className="sticker-card p-5 flex items-center gap-4">
        {profile.avatar ? (
          <img src={profile.avatar} alt={profile.name} className="w-14 h-14 rounded-2xl border-2" style={{ borderColor: "rgb(var(--ink))" }} />
        ) : (
          <div className="w-14 h-14 rounded-2xl border-2 flex items-center justify-center text-2xl font-display font-extrabold" style={{ borderColor: "rgb(var(--ink))", background: "rgb(var(--teal-light))", color: "rgb(var(--teal-deep))" }}>
            {profile.name[0]?.toUpperCase()}
          </div>
        )}
        <div className="flex flex-col flex-1 min-w-0">
          <span className="font-display font-extrabold text-xl truncate" style={{ color: "rgb(var(--ink))" }}>{profile.name}</span>
          <span className="text-xs font-semibold" style={{ color: "rgb(var(--ink-3))" }}>{profile.kind} · joined {profile.createdAt ? new Date(profile.createdAt).toLocaleDateString() : "—"}</span>
          {openRating && <span className="text-sm font-extrabold mt-1" style={{ color: "rgb(var(--teal))" }}>{openRating.conservative} rating</span>}
        </div>
      </div>

      {/* Titles */}
      {titles.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {titles.map((t) => (
            <span key={t.title} className="chip" style={{ background: "rgb(var(--amber))", borderColor: "rgb(var(--ink))", color: "rgb(var(--ink))" }}>{t.title}</span>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Wins",   value: stats.wins,   color: "rgb(var(--teal))"   },
          { label: "Draws",  value: stats.draws,  color: "rgb(var(--amber))"  },
          { label: "Losses", value: stats.losses, color: "rgb(var(--danger))" },
        ].map(({ label, value, color }) => (
          <div key={label} className="sticker-card-sm p-3 text-center">
            <div className="font-display font-extrabold text-2xl" style={{ color }}>{value}</div>
            <div className="text-xs font-bold" style={{ color: "rgb(var(--ink-3))" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Streaks */}
      {streaks.length > 0 && (
        <div className="sticker-card-sm p-4 flex flex-col gap-2">
          <span className="font-display font-extrabold text-sm mb-1" style={{ color: "rgb(var(--ink))" }}>Streaks</span>
          {streaks.map((s) => (
            <div key={s.class} className="flex items-center justify-between text-sm">
              <span className="font-semibold capitalize" style={{ color: "rgb(var(--ink-2))" }}>{s.class} class</span>
              <div className="flex gap-3">
                <span className="font-extrabold" style={{ color: s.current_streak > 0 ? "rgb(var(--teal))" : s.current_streak < 0 ? "rgb(var(--danger))" : "rgb(var(--ink-3))" }}>
                  {s.current_streak > 0 ? `${s.current_streak}W` : s.current_streak < 0 ? `${Math.abs(s.current_streak)}L` : "—"}
                </span>
                <span className="text-xs font-semibold" style={{ color: "rgb(var(--ink-3))" }}>best {s.best_streak}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ratings */}
      {ratings.length > 0 && (
        <div className="sticker-card-sm p-4 flex flex-col gap-2">
          <span className="font-display font-extrabold text-sm mb-1" style={{ color: "rgb(var(--ink))" }}>Ratings</span>
          {ratings.map((r) => (
            <div key={`${r.class}-${r.timeControl}`} className="flex items-center justify-between text-sm border-b-2 last:border-b-0 pb-2 last:pb-0" style={{ borderColor: "rgb(var(--ink) / 0.08)" }}>
              <div>
                <span className="font-extrabold font-display capitalize" style={{ color: "rgb(var(--ink))" }}>{r.class}</span>
                <span className="ml-2 font-semibold" style={{ color: "rgb(var(--ink-3))" }}>{r.timeControl}</span>
              </div>
              <div className="flex gap-3 items-center">
                <span className="font-extrabold" style={{ color: "rgb(var(--teal))" }}>{r.conservative}</span>
                <span className="text-xs font-semibold" style={{ color: "rgb(var(--ink-3))" }}>{r.games} games</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent games */}
      <div className="sticker-card-sm p-4 flex flex-col gap-2">
        <span className="font-display font-extrabold text-sm mb-1" style={{ color: "rgb(var(--ink))" }}>Recent games</span>
        {recentGames.length === 0 && <p className="text-sm font-semibold" style={{ color: "rgb(var(--ink-3))" }}>No games yet.</p>}
        {recentGames.map((g) => (
          <Link key={g.id} href={`/g/${g.id}`}
            className="flex items-center justify-between rounded-2xl px-2 py-1.5 transition-colors hover:opacity-80">
            <div className="flex flex-col">
              <span className="mono text-xs" style={{ color: "rgb(var(--ink-3))" }}>{g.id}</span>
              <span className="text-xs font-semibold" style={{ color: "rgb(var(--ink-2))" }}>{g.timeControl} · {g.class}</span>
            </div>
            <span className="rounded-full border-2 px-2.5 py-0.5 text-xs font-extrabold capitalize" style={RESULT_STYLE[g.playerResult] ?? {}}>
              {g.playerResult}
            </span>
          </Link>
        ))}
      </div>

      <button onClick={() => { void load(); }} disabled={loading}
        className="pop-btn-ghost pop-btn self-center rounded-full px-6 py-2 text-sm font-bold">
        {loading ? "…" : "Refresh"}
      </button>
    </>
  );
}
