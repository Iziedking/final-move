"use client";
import { API_BASE } from "@/lib/api";
import { botName } from "@/lib/bots";
import { useNames } from "@/lib/names";
import Link from "next/link";
import Image from "next/image";
import type React from "react";
import { useState, useCallback, useEffect } from "react";
import { BotAvatar } from "@/components/BotAvatar";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";

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

const RESULT: Record<string, { label: string; bg: string; fg: string }> = {
  win:     { label: "Won",        bg: "rgb(var(--mint))",    fg: "rgb(var(--candy-ink))" },
  loss:    { label: "Lost",       bg: "rgb(var(--coral))",   fg: "#fff" },
  draw:    { label: "Draw",       bg: "rgb(var(--cyan))",    fg: "rgb(var(--candy-ink))" },
  aborted: { label: "Called off", bg: "rgb(var(--cloud-2))", fg: "rgb(var(--ink-2))" },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 pt-8 sm:px-6 lg:px-10 lg:pt-12">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function ProfileClient({ playerId, initialData }: { playerId: string; initialData: ProfileData | null }): React.JSX.Element {
  const [data, setData]       = useState<ProfileData | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/profile/${playerId}`);
      if (res.ok) { setData(await res.json() as ProfileData); setMissing(false); }
      else if (res.status === 404) setMissing(true);
    } catch { /* keep what we have; the retry button stays */ }
    finally { setLoading(false); }
  }, [playerId]);

  // The server render may have missed the API; fetch from the browser instead.
  useEffect(() => { if (!initialData) void load(); }, [initialData, load]);

  const opponents = (data?.recentGames ?? []).map((g) => {
    const id = g.playerColor === "w" ? g.blackId : g.whiteId;
    return { id };
  });
  const names = useNames(opponents);

  if (!data) {
    return (
      <Shell>
        <div className="sticker-card mx-auto mt-6 flex w-full max-w-[460px] flex-col items-center gap-4 p-8 text-center" aria-live="polite">
          {loading ? (
            <>
              <div className="h-7 w-7 animate-spin rounded-full border-[3px]" style={{ borderColor: "rgb(var(--violet))", borderTopColor: "transparent" }} />
              <p className="font-display text-[20px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Loading profile…</p>
            </>
          ) : missing ? (
            <>
              <p className="font-display text-[26px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>No player here</p>
              <p className="text-[15px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>This profile does not exist. Players appear once they sign in and play.</p>
              <Link href="/leaderboard" className="pop-btn min-h-[48px] px-6 text-[15px]">See the leaderboard</Link>
            </>
          ) : (
            <>
              <p className="font-display text-[24px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>We could not load this profile</p>
              <p className="text-[15px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>Check your connection and try again.</p>
              <button type="button" onClick={() => { void load(); }} className="pop-btn min-h-[48px] px-6 text-[15px]">Try again</button>
            </>
          )}
        </div>
      </Shell>
    );
  }

  const { profile, stats, ratings, streaks, titles, recentGames } = data;
  const isBot = profile.kind === "bot" || profile.id.startsWith("bot_");
  const isMachine = isBot || profile.kind === "agent";
  const displayName = isBot ? (botName(profile.id) ?? profile.name) : profile.kind === "agent" ? profile.name : `@${profile.name.replace(/^@/, "")}`;
  const best = [...ratings].sort((a, b) => b.conservative - a.conservative)[0];
  const winRate = stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : null;

  return (
    <Shell>
      {/* Identity */}
      <section className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <span className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[26px]" style={{ border: "var(--line) solid rgb(var(--ink))", background: "rgb(var(--violet-light))", boxShadow: "4px 4px 0 rgb(var(--pop-shadow))", transform: "rotate(-3deg)" }}>
          {isMachine ? <BotAvatar botId={profile.id} className="h-full w-full p-1.5" />
            : profile.avatar ? <Image src={profile.avatar} alt="" fill sizes="96px" className="object-cover" />
            : <span className="grid h-full w-full place-items-center font-display text-[40px] font-extrabold" style={{ color: "rgb(var(--violet))" }}>{profile.name.replace("@", "")[0]?.toUpperCase()}</span>}
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-display font-extrabold" style={{ fontSize: "clamp(34px, 5vw, 56px)", lineHeight: 1, color: "rgb(var(--ink))" }}>{displayName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="chip" style={{ background: isBot ? "rgb(var(--cyan))" : profile.kind === "agent" ? "rgb(var(--amber))" : "rgb(var(--mint))", color: "rgb(var(--candy-ink))" }}>
              {isBot ? "House bot" : profile.kind === "agent" ? "Agent" : "Player"}
            </span>
            {titles.map((t) => (
              <span key={t.title} className="chip" style={{ background: "rgb(var(--amber))", color: "rgb(var(--candy-ink))" }}>★ {t.title}</span>
            ))}
            {profile.createdAt && (
              <span className="text-[13px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>Joined {new Date(profile.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
            )}
          </div>
        </div>
      </section>

      {/* Numbers */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-label="Record">
        {[
          { label: best ? `Best rating · ${best.class === "human" ? "Human" : "Open"} ${best.timeControl.replace("+", " + ")}` : "Rating", value: best ? String(best.conservative) : "–", color: "rgb(var(--violet))" },
          { label: "Wins", value: String(stats.wins), color: "rgb(var(--ink))" },
          { label: "Draws", value: String(stats.draws), color: "rgb(var(--ink))" },
          { label: "Losses", value: String(stats.losses), color: "rgb(var(--ink))" },
        ].map((s) => (
          <div key={s.label} className="sticker-card p-4">
            <div className="font-display text-[40px] font-extrabold leading-none tabular-nums" style={{ color: s.color }}>{s.value}</div>
            <div className="mt-1.5 text-[13px] font-extrabold" style={{ color: "rgb(var(--ink-3))" }}>{s.label}</div>
          </div>
        ))}
      </section>
      {winRate !== null && (
        <div className="-mt-2">
          <div className="flex h-4 overflow-hidden rounded-full" style={{ border: "2px solid rgb(var(--ink))" }} role="img" aria-label={`${stats.wins} wins, ${stats.draws} draws, ${stats.losses} losses`}>
            <div style={{ width: `${(stats.wins / stats.total) * 100}%`, background: "rgb(var(--mint))" }} />
            <div style={{ width: `${(stats.draws / stats.total) * 100}%`, background: "rgb(var(--cyan))" }} />
            <div style={{ width: `${(stats.losses / stats.total) * 100}%`, background: "rgb(var(--coral))" }} />
          </div>
          <p className="mt-1.5 text-[13px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>{winRate}% won across {stats.total} games</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Recent games */}
        <section className="sticker-card p-5" aria-labelledby="recent">
          <h2 id="recent" className="mb-3 font-display text-[24px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Recent games</h2>
          {recentGames.length === 0 ? (
            <div className="flex flex-col items-start gap-3 py-2">
              <p className="text-[15px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>No finished games yet.</p>
              <Link href="/" className="pop-btn min-h-[44px] px-5 text-[14px]">Play a game</Link>
            </div>
          ) : (
            <ul className="flex flex-col">
              {recentGames.map((g) => {
                const r = RESULT[g.playerResult] ?? RESULT.aborted!;
                const oppId = g.playerColor === "w" ? g.blackId : g.whiteId;
                return (
                  <li key={g.id} style={{ borderBottom: "2px solid rgb(var(--ink) / 0.08)" }} className="last:border-b-0">
                    <Link href={`/g/${g.id}`} className="flex min-h-[56px] items-center gap-3 rounded-xl px-2 py-2 hover:bg-[rgb(var(--violet-light))]">
                      <span className="h-3.5 w-3.5 shrink-0 rounded-full" role="img" aria-label={g.playerColor === "w" ? "played white" : "played black"} style={{ background: g.playerColor === "w" ? "#fff" : "rgb(var(--piece-black))", border: "2px solid rgb(var(--piece-line))" }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-[16px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>vs {names[oppId]?.name ?? "…"}</span>
                        <span className="text-[12px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>
                          {g.timeControl.replace("+", " + ")} · {g.class === "human" ? "Human" : "Open"} · {new Date(g.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      </span>
                      <span className="chip shrink-0" style={{ background: r.bg, color: r.fg }}>{r.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-6">
          {ratings.length > 0 && (
            <section className="sticker-card p-5" aria-labelledby="ratings">
              <h2 id="ratings" className="mb-3 font-display text-[24px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Ratings</h2>
              <ul className="flex flex-col gap-2">
                {ratings.map((r) => (
                  <li key={`${r.class}-${r.timeControl}`} className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: "rgb(var(--cloud-2))" }}>
                    <span className="text-[14px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>
                      {r.class === "human" ? "Human" : "Open"} <span style={{ color: "rgb(var(--ink-3))" }}>{r.timeControl.replace("+", " + ")}</span>
                    </span>
                    <span className="text-right">
                      <span className="block font-display text-[20px] font-extrabold leading-none tabular-nums" style={{ color: "rgb(var(--violet))" }}>{r.conservative}</span>
                      <span className="text-[11px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>{r.games} games</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {streaks.length > 0 && (
            <section className="sticker-card p-5" aria-labelledby="streaks">
              <h2 id="streaks" className="mb-3 font-display text-[24px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Streaks</h2>
              <ul className="flex flex-col gap-2">
                {streaks.map((s) => (
                  <li key={s.class} className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: "rgb(var(--cloud-2))" }}>
                    <span className="text-[14px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>{s.class === "human" ? "Human" : "Open"} class</span>
                    <span className="flex items-center gap-3">
                      <span className="font-display text-[18px] font-extrabold" style={{ color: s.current_streak > 0 ? "rgb(var(--mint))" : s.current_streak < 0 ? "rgb(var(--coral))" : "rgb(var(--ink-3))" }}>
                        {s.current_streak > 0 ? `${s.current_streak} wins` : s.current_streak < 0 ? `${Math.abs(s.current_streak)} losses` : "None"}
                      </span>
                      <span className="text-[12px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>best {s.best_streak}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <button type="button" onClick={() => { void load(); }} disabled={loading} className="pop-btn pop-btn-ghost min-h-[44px] self-start px-5 text-[14px]">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
    </Shell>
  );
}
