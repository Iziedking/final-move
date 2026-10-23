"use client";
/**
 * The Saturday Cup: the next or current cup up top as an amber sticker with
 * its countdown and prize, then entrants, the bracket and the games. Signed-in
 * players register from here; guests are asked to sign in first.
 */
import Link from "next/link";
import type React from "react";
import { useState, useEffect, useCallback } from "react";
import { signIn, useSession } from "next-auth/react";
import { API_BASE } from "@/lib/api";
import { apiFetch, describeError } from "@/lib/session";
import { botName } from "@/lib/bots";
import { useNames } from "@/lib/names";
import { BotAvatar } from "@/components/BotAvatar";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";

interface BracketMatch { round: number; index: number; a: number | null; b: number | null; winner: number | null; }
interface Bracket { size: number; rounds: BracketMatch[][]; }
interface TournamentEntry { playerId: string; playerKind: string; placement: number | null; prizeUsdc6: string; }
interface TournamentMatch { game_id: string; round: number; match_index: number; white_player_id: string; black_player_id: string; winner_id: string | null; }
interface Tournament {
  id: string; name: string; class: string; status: string; timeControl: string; prizePoolUsdc6: string;
  regClose: string; startsAt: string; entries?: TournamentEntry[]; games?: TournamentMatch[]; bracket?: Bracket | null;
}

const API = API_BASE;
const usdc = (usdc6: string | undefined) => Number(usdc6 || "0") / 1_000_000;
const fmtUsdc = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  open:    { label: "Registration open", bg: "var(--mint)",   fg: "var(--candy-ink)" },
  running: { label: "Playing now",       bg: "var(--violet)", fg: "255 255 255" },
  done:    { label: "Finished",          bg: "var(--cloud-2)", fg: "var(--ink-2)" },
};

function useCountdown(target: string | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!target) return "";
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return "";
  const d = Math.floor(ms / 86_400_000), h = Math.floor(ms / 3_600_000) % 24, m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

/** A readable name for an entrant: bots by name, people by X handle, agents by name. */
function Entrant({ id, kind, size = "sm" }: { id: string; kind?: string; size?: "sm" | "md" }) {
  const bot = kind === "bot" || id.startsWith("bot_") ? botName(id) : undefined;
  const looked = useNames(bot ? [] : [{ id, kind }])[id]?.name;
  const avatar = size === "md" ? "h-9 w-9" : "h-6 w-6";
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {bot || kind === "agent" ? (
        <BotAvatar botId={id} className={`${avatar} shrink-0`} />
      ) : (
        <span className={`${avatar} grid shrink-0 place-items-center rounded-full text-[11px] font-extrabold`} style={{ background: "rgb(var(--sky-2))", border: "2px solid rgb(var(--ink))", color: "rgb(var(--ink))" }} aria-hidden>
          {kind === "agent" ? "A" : "P"}
        </span>
      )}
      {bot
        ? <span className="truncate font-display font-extrabold">{bot}</span>
        : <span className="truncate font-display font-extrabold" title={id}>{looked ?? "…"}</span>}
    </span>
  );
}

function MatchCard({ match, entries }: { match: BracketMatch; entries: TournamentEntry[] }) {
  const side = (slot: number | null, first: boolean) => {
    const e = slot !== null ? entries[slot] : undefined;
    const won = match.winner !== null && match.winner === slot && slot !== null;
    const decided = match.winner !== null;
    return (
      <div
        className={`flex min-h-[44px] items-center justify-between gap-2 px-3 py-2 text-[14px] ${first ? "border-b-2" : ""}`}
        style={{
          borderColor: "rgb(var(--ink) / 0.15)",
          background: won ? "rgb(var(--amber))" : "rgb(var(--cloud))",
          color: "rgb(var(--ink))",
          opacity: decided && !won ? 0.55 : 1,
        }}
      >
        {e ? <Entrant id={e.playerId} kind={e.playerKind} /> : <span className="font-extrabold" style={{ color: "rgb(var(--ink-3))" }}>{slot === null ? "Bye" : "To be decided"}</span>}
        {won && <span className="chip shrink-0 py-0 text-[10px]" style={{ background: "rgb(var(--cloud))" }}>Won</span>}
      </div>
    );
  };
  return (
    <div className="w-[220px] overflow-hidden" style={{ border: "var(--line) solid rgb(var(--ink))", borderRadius: "var(--r)", boxShadow: "3px 3px 0 rgb(var(--pop-shadow))" }}>
      {side(match.a, true)}
      {side(match.b, false)}
    </div>
  );
}

function BracketView({ bracket, entries }: { bracket: Bracket; entries: TournamentEntry[] }) {
  const n = bracket.rounds.length;
  const roundName = (i: number) => {
    const left = n - i;
    return left === 1 ? "Final" : left === 2 ? "Semi-finals" : left === 3 ? "Quarter-finals" : `Round ${i + 1}`;
  };
  return (
    <div className="flex gap-6 overflow-x-auto pb-3">
      {bracket.rounds.map((round, ri) => (
        <div key={ri} className="flex shrink-0 flex-col gap-3">
          <p className="font-display text-[16px] font-extrabold" style={{ color: "rgb(var(--ink-2))" }}>{roundName(ri)}</p>
          <div className="flex flex-1 flex-col justify-around gap-4">
            {round.map((m) => <MatchCard key={`${ri}-${m.index}`} match={m} entries={entries} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CupClient(): React.JSX.Element {
  const { data: session } = useSession();
  const signedInId = session?.user?.id ?? null;
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [reg, setReg] = useState<{ state: "idle" | "sending" | "done" | "error"; msg?: string }>({ state: "idle" });

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch(`${API}/v1/tournaments`);
      const d = await res.json() as { tournaments: Tournament[] };
      const list = d.tournaments ?? [];
      setTournaments(list);
      // Open on the cup that matters now: running, else the next one, else the latest.
      setSelectedId((cur) => {
        if (cur) return cur;
        const running = list.find((t) => t.status === "running");
        const next = list
          .filter((t) => t.status === "open")
          .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];
        return (running ?? next ?? list[0])?.id ?? null;
      });
    } catch { /* keep the last list */ } finally { setLoading(false); }
  }, []);

  const fetchOne = useCallback(async (id: string) => {
    try { const res = await fetch(`${API}/v1/tournaments/${id}`); if (res.ok) setSelected(await res.json() as Tournament); }
    catch { /* keep the last state */ }
  }, []);

  useEffect(() => { void fetchList(); const id = setInterval(() => void fetchList(), 10_000); return () => clearInterval(id); }, [fetchList]);
  useEffect(() => {
    if (!selectedId) return;
    setReg({ state: "idle" });
    void fetchOne(selectedId);
    const id = setInterval(() => void fetchOne(selectedId), 5_000);
    return () => clearInterval(id);
  }, [selectedId, fetchOne]);

  const register = async () => {
    if (!selected) return;
    setReg({ state: "sending" });
    const r = await apiFetch(`/v1/tournaments/${selected.id}/register`, { method: "POST" }, signedInId).catch(() => null);
    if (r?.ok) { setReg({ state: "done" }); void fetchOne(selected.id); return; }
    const body = (await r?.json().catch(() => null)) as { error?: string } | null;
    setReg({ state: "error", msg: describeError(body?.error) });
  };

  const t = selected && selected.id === selectedId ? selected : tournaments.find((x) => x.id === selectedId) ?? null;
  const entries = t?.entries ?? [];
  const games = t?.games ?? [];
  const regLeft = useCountdown(t?.regClose);
  const startLeft = useCountdown(t?.startsAt);
  const prize = usdc(t?.prizePoolUsdc6);
  const champion = entries.find((e) => e.placement === 1);
  const iAmIn = !!signedInId && entries.some((e) => e.playerId === signedInId);
  const regOpen = t?.status === "open" && !!regLeft;
  const status = t ? STATUS[t.status] ?? { label: t.status, bg: "var(--cloud-2)", fg: "var(--ink-2)" } : null;
  const standings = [...entries].sort((a, b) => (a.placement ?? 999) - (b.placement ?? 999));

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-8 px-4 pt-8 sm:px-6">
        <div>
          <h1 className="font-display font-extrabold" style={{ fontSize: "clamp(36px, 5vw, 60px)", lineHeight: 1.02, color: "rgb(var(--ink))" }}>Saturday Cup</h1>
          <p className="mt-2 max-w-[620px] text-[17px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
            A weekly knockout. Lose once and you are out. Prizes are paid onchain from the cup&apos;s own pool to the winners&apos; wallets.
          </p>
        </div>

        {loading ? (
          <div className="sticker-card h-[220px] animate-pulse" style={{ background: "rgb(var(--cloud-2))" }} aria-label="Loading the cups" />
        ) : tournaments.length === 0 ? (
          <div className="sticker-card flex flex-col items-start gap-3 p-6">
            <p className="font-display text-[22px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>No cup is scheduled right now</p>
            <p className="text-[15px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>When the next one opens for registration it will appear here. Warm up against a bot in the meantime.</p>
            <Link href="/" className="pop-btn px-5 text-[15px]">Play a bot</Link>
          </div>
        ) : t && status && (
          <>
            {/* The cup */}
            <section className="sticker-card-lg relative flex flex-col gap-5 overflow-hidden p-5 sm:p-7" style={{ background: "rgb(var(--amber))", color: "rgb(var(--candy-ink))" }} aria-labelledby="cup-name">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip" style={{ background: `rgb(${status.bg})`, color: `rgb(${status.fg})` }}>{status.label}</span>
                <span className="chip" style={{ background: "rgb(var(--cloud))" }}>{t.timeControl} · {t.class === "human" ? "Human class" : "Open class"}</span>
              </div>
              <h2 id="cup-name" className="font-display font-extrabold" style={{ fontSize: "clamp(30px, 4vw, 46px)", lineHeight: 1 }}>{t.name}</h2>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-[13px] font-extrabold opacity-80">{regOpen ? "Registration closes in" : t.status === "open" ? "Starts in" : "Started"}</p>
                  <p className="font-display text-[34px] font-extrabold leading-none tabular-nums" aria-live="off">
                    {regOpen ? regLeft : t.status === "open" ? (startLeft || "Any moment") : new Date(t.startsAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                  </p>
                </div>
                <div>
                  <p className="text-[13px] font-extrabold opacity-80">Prize pool</p>
                  <p className="font-display text-[34px] font-extrabold leading-none tabular-nums">{prize > 0 ? `${fmtUsdc(prize)} USDC` : "Free cup"}</p>
                </div>
                <div>
                  <p className="text-[13px] font-extrabold opacity-80">Entrants</p>
                  <p className="font-display text-[34px] font-extrabold leading-none tabular-nums">{entries.length}</p>
                </div>
              </div>

              {t.status === "open" && (
                <div className="flex flex-col items-start gap-2" aria-live="polite">
                  {!session?.user ? (
                    <>
                      <button type="button" onClick={() => signIn("twitter")} className="pop-btn min-h-[52px] px-6 text-[16px]">Sign in with X to enter</button>
                      <p className="text-[14px] font-bold">Entrants register onchain from their own wallet, so guests cannot enter.</p>
                    </>
                  ) : iAmIn || reg.state === "done" ? (
                    <p className="chip py-2 text-[14px]" style={{ background: "rgb(var(--mint))" }}>You are in. Your first game opens here when the cup starts.</p>
                  ) : regOpen ? (
                    <button type="button" onClick={() => { void register(); }} disabled={reg.state === "sending"} className="pop-btn min-h-[52px] px-6 text-[16px]">
                      {reg.state === "sending" ? "Registering onchain…" : "Enter the cup"}
                    </button>
                  ) : (
                    <p className="text-[14px] font-bold">Registration has closed.</p>
                  )}
                  {reg.state === "error" && <p className="text-[14px] font-extrabold" role="alert">{reg.msg}</p>}
                </div>
              )}

              {t.status === "done" && champion && (
                <div className="flex flex-wrap items-center gap-4 rounded-[var(--r)] p-4" style={{ background: "rgb(var(--cloud))", border: "var(--line) solid rgb(var(--ink))" }}>
                  <span
                    className="px-4 py-1.5 font-display text-[24px] font-extrabold"
                    style={{ background: "rgb(var(--violet))", color: "#fff", border: "var(--line) solid rgb(var(--ink))", borderRadius: "var(--r)", boxShadow: "3px 3px 0 rgb(var(--pop-shadow))", transform: "rotate(-3deg)" }}
                  >
                    Champion
                  </span>
                  <span className="text-[18px]" style={{ color: "rgb(var(--ink))" }}><Entrant id={champion.playerId} kind={champion.playerKind} size="md" /></span>
                  {usdc(champion.prizeUsdc6) > 0 && (
                    <span className="font-display text-[20px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>+{fmtUsdc(usdc(champion.prizeUsdc6))} USDC</span>
                  )}
                </div>
              )}
            </section>

            {/* Bracket */}
            <section className="sticker-card p-5" aria-labelledby="bracket">
              <h3 id="bracket" className="mb-4 font-display text-[24px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Bracket</h3>
              {t.bracket ? (
                <BracketView bracket={t.bracket} entries={entries} />
              ) : (
                <p className="text-[15px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>The bracket is drawn when registration closes.</p>
              )}
            </section>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* Entrants and standings */}
              <section className="sticker-card p-5" aria-labelledby="entrants">
                <h3 id="entrants" className="mb-3 font-display text-[22px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>
                  {t.status === "done" ? "Final standings" : "Entrants"}
                </h3>
                {standings.length === 0 ? (
                  <p className="text-[15px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>Nobody has entered yet.</p>
                ) : (
                  <ol className="flex flex-col gap-1.5">
                    {standings.map((e) => (
                      <li key={e.playerId} className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl px-3 py-2" style={{ background: "rgb(var(--cloud-2))", color: "rgb(var(--ink))" }}>
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="w-7 text-right font-display text-[16px] font-extrabold tabular-nums" style={{ color: e.placement === 1 ? "rgb(var(--violet))" : "rgb(var(--ink-3))" }}>
                            {e.placement !== null ? `${e.placement}` : "·"}
                          </span>
                          <Entrant id={e.playerId} kind={e.playerKind} />
                          {e.playerId === signedInId && <span className="chip py-0 text-[10px]" style={{ background: "rgb(var(--violet))", color: "#fff" }}>You</span>}
                        </span>
                        {usdc(e.prizeUsdc6) > 0 && <span className="font-display text-[15px] font-extrabold">+{fmtUsdc(usdc(e.prizeUsdc6))} USDC</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              {/* Games */}
              <section className="sticker-card p-5" aria-labelledby="games">
                <h3 id="games" className="mb-3 font-display text-[22px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Games</h3>
                {games.length === 0 ? (
                  <p className="text-[15px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>Games appear here once the cup starts.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {games.map((g) => {
                      const live = !g.winner_id;
                      return (
                        <li key={g.game_id}>
                          <Link
                            href={live ? `/game/${g.game_id}` : `/g/${g.game_id}`}
                            className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl px-3 py-2 transition-colors hover:bg-[rgb(var(--violet-light))]"
                            style={{ background: "rgb(var(--cloud-2))", color: "rgb(var(--ink))" }}
                          >
                            <span className="flex min-w-0 items-center gap-2 text-[14px]">
                              <span className="shrink-0 text-[12px] font-extrabold" style={{ color: "rgb(var(--ink-3))" }}>R{g.round + 1}</span>
                              <span style={{ fontWeight: g.winner_id === g.white_player_id ? 900 : undefined }}><Entrant id={g.white_player_id} /></span>
                              <span className="shrink-0 text-[12px] font-extrabold" style={{ color: "rgb(var(--ink-3))" }}>vs</span>
                              <span style={{ fontWeight: g.winner_id === g.black_player_id ? 900 : undefined }}><Entrant id={g.black_player_id} /></span>
                            </span>
                            {live
                              ? <span className="chip shrink-0 py-0 text-[11px]" style={{ background: "rgb(var(--mint))" }}>Live</span>
                              : <span className="shrink-0 text-[13px] font-extrabold" style={{ color: "rgb(var(--violet))" }}>Replay</span>}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>

            {/* Other cups */}
            {tournaments.length > 1 && (
              <section aria-labelledby="other-cups">
                <h3 id="other-cups" className="mb-3 font-display text-[22px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Other cups</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {tournaments.map((x) => {
                    const st = STATUS[x.status] ?? { label: x.status, bg: "var(--cloud-2)", fg: "var(--ink-2)" };
                    const on = x.id === selectedId;
                    return (
                      <button
                        key={x.id}
                        type="button"
                        onClick={() => setSelectedId(x.id)}
                        aria-pressed={on}
                        className="sticker-card-sm flex flex-col items-start gap-2 p-4 text-left transition-transform hover:-translate-y-0.5"
                        style={{ background: on ? "rgb(var(--violet-light))" : "rgb(var(--cloud))" }}
                      >
                        <span className="font-display text-[18px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>{x.name}</span>
                        <span className="text-[13px] font-bold" style={{ color: "rgb(var(--ink-2))" }}>
                          {new Date(x.startsAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · {x.timeControl}
                          {usdc(x.prizePoolUsdc6) > 0 ? ` · ${fmtUsdc(usdc(x.prizePoolUsdc6))} USDC` : ""}
                        </span>
                        <span className="chip py-0 text-[11px]" style={{ background: `rgb(${st.bg})`, color: `rgb(${st.fg})` }}>{st.label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
