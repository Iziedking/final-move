"use client";
import type React from "react";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { Session } from "next-auth";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { apiFetch, describeError } from "@/lib/session";
import { API_BASE } from "@/lib/api";
import { explorerTx } from "@/lib/utils";
import { BOTS } from "@/lib/bots";
import { HvMScoreboard } from "@/components/HvMScoreboard";
import { BotAvatar } from "@/components/BotAvatar";
import { HeroBoard } from "@/components/HeroBoard";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";

const TIME_CONTROLS = [
  { id: "3+2",  label: "3 + 2",  desc: "Blitz" },
  { id: "5+3",  label: "5 + 3",  desc: "Blitz" },
  { id: "10+5", label: "10 + 5", desc: "Rapid" },
] as const;

interface Props { session: Session | null; }

/* ── Live chain ticker ─────────────────────────────────────────────────── */
interface FeedMove { gameId: string; ply: number; uci: string; txHash: string; finalMs: number | null }

/** Real moves as they become final on Arc. Each one links to its transaction. */
function ChainTicker() {
  const [moves, setMoves] = useState<FeedMove[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API_BASE}/v1/feed/recent`)
        .then((r) => (r.ok ? r.json() as Promise<{ moves: FeedMove[] }> : { moves: [] }))
        .then((d) => { if (alive) setMoves(d.moves); })
        .catch(() => { if (alive) setMoves([]); });
    void load();
    const timer = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const shell = "w-full overflow-hidden py-2.5";
  const shellStyle: React.CSSProperties = { background: "rgb(var(--violet))", color: "#fff", borderBlock: "var(--line) solid rgb(var(--pop-shadow))" };
  if (moves === null) return <div className={shell} style={{ ...shellStyle, height: 42 }} aria-hidden />;
  if (moves.length === 0) {
    return (
      <div className={`${shell} text-center text-[13px] font-extrabold`} style={shellStyle}>
        Moves show up here the moment they are final on Arc.
      </div>
    );
  }
  const doubled = [...moves, ...moves]; // seamless loop
  return (
    <div className={shell} style={shellStyle} aria-label="Moves just finalised on Arc">
      <div className="animate-chain-scroll flex gap-8 whitespace-nowrap" style={{ width: "max-content" }}>
        {doubled.map((m, i) => (
          <a
            key={`${m.txHash}-${i}`}
            href={explorerTx(m.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            aria-hidden={i >= moves.length}
            tabIndex={i >= moves.length ? -1 : 0}
            className="inline-flex items-center gap-2 text-[13px] font-extrabold hover:underline"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: "rgb(var(--mint))" }} />
            <span className="font-display">{m.uci.slice(0, 2)}–{m.uci.slice(2, 4)}{m.uci[4] ? `=${m.uci[4].toUpperCase()}` : ""}</span>
            <span className="font-mono text-[11px] font-medium opacity-70">{m.txHash.slice(0, 8)}…</span>
            {m.finalMs !== null && <span style={{ color: "rgb(var(--mint))" }}>final in {(m.finalMs / 1000).toFixed(1)} s</span>}
          </a>
        ))}
      </div>
    </div>
  );
}

/* ── Saturday Cup card ─────────────────────────────────────────────────── */
interface Cup { id: string; name: string; startsAt: string; regClose: string; status: string; prizePoolUsdc6: string; timeControl: string }

function useCountdown(target: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (target === null) return "";
  const ms = Math.max(0, target - now);
  const d = Math.floor(ms / 86_400_000), h = Math.floor(ms / 3_600_000) % 24, m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function CupCard() {
  const [cup, setCup] = useState<Cup | null | undefined>(undefined);
  useEffect(() => {
    fetch(`${API_BASE}/v1/tournaments`)
      .then((r) => r.json() as Promise<{ tournaments?: Cup[] }>)
      .then((d) => {
        const list = d.tournaments ?? [];
        const upcoming = list
          .filter((t) => new Date(t.startsAt).getTime() > Date.now())
          .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
        setCup(upcoming[0] ?? list.find((t) => t.status === "running") ?? null);
      })
      .catch(() => setCup(null));
  }, []);
  const starts = cup ? new Date(cup.startsAt).getTime() : null;
  const left = useCountdown(starts);
  const prize = cup ? Number(BigInt(cup.prizePoolUsdc6 || "0")) / 1e6 : 0;

  return (
    <div className="sticker-card relative flex h-full flex-col gap-3 overflow-hidden p-5" style={{ background: "rgb(var(--amber))", color: "rgb(var(--candy-ink))" }}>
      <span className="chip self-start" style={{ background: "rgb(var(--cloud))" }}>Every Saturday</span>
      <h3 className="font-display text-[28px] font-extrabold leading-none">{cup?.name ?? "Saturday Cup"}</h3>
      {cup === undefined ? (
        <div className="h-10 w-40 rounded-xl" style={{ background: "rgb(var(--cloud) / 0.4)" }} aria-hidden />
      ) : cup ? (
        <>
          <p className="font-display text-[34px] font-extrabold leading-none tabular-nums" aria-label={`Starts in ${left}`}>
            {cup.status === "running" ? "Playing now" : left}
          </p>
          <p className="text-[14px] font-bold">
            {cup.timeControl} knockout{prize > 0 ? ` · ${prize.toLocaleString()} USDC in prizes, paid onchain` : " · free to enter"}
          </p>
        </>
      ) : (
        <p className="text-[15px] font-bold">No Cup is scheduled right now. Check back soon.</p>
      )}
      <Link href="/cup" className="pop-btn pop-btn-ghost mt-auto self-start px-5 text-[15px]">
        {cup && cup.status !== "running" ? "Enter the Cup" : "See the Cup"}
      </Link>
    </div>
  );
}

/* ── Ways to play ──────────────────────────────────────────────────────── */
function WayCard({ tone, tilt, title, body, href, onClick, cta, art }: {
  tone: string; tilt: number; title: string; body: string; href?: string; onClick?: () => void; cta: string; art: React.ReactNode;
}) {
  const cls = "sticker-card group flex min-w-0 flex-col gap-3 p-5 text-left transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_rgb(var(--pop-shadow))]";
  const style = { transform: `rotate(${tilt}deg)` };
  const inner = (
    <>
      <div className="flex h-16 items-center gap-1 overflow-hidden rounded-2xl px-3" style={{ background: `rgb(var(${tone}) / 0.22)`, border: "2px solid rgb(var(--ink))" }}>{art}</div>
      <h3 className="font-display text-[22px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>{title}</h3>
      <p className="text-[15px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>{body}</p>
      <span className="mt-auto text-[14px] font-extrabold" style={{ color: "rgb(var(--violet))" }}>{cta} →</span>
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className={cls} style={style}>{inner}</button>
    : <Link href={href ?? "/"} className={cls} style={style}>{inner}</Link>;
}

/* ── Page ──────────────────────────────────────────────────────────────── */
export function HomeClient({ session }: Props): React.JSX.Element {
  const [showPlay, setShowPlay] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  const signedIn = !!session?.user;

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      <SiteHeader />

      <main className="flex flex-col">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-[1120px] grid-cols-1 items-center gap-10 px-4 pb-12 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] lg:pt-14">
          <div className="flex flex-col items-start gap-5 animate-fade-up">
            <span className="chip" style={{ background: "rgb(var(--amber))", color: "rgb(var(--candy-ink))" }}>
              <span className="h-2 w-2 rounded-full" style={{ background: "rgb(var(--ink))" }} /> Live on Arc testnet
            </span>
            <h1 className="font-display font-extrabold" style={{ fontSize: "clamp(44px, 6.4vw, 78px)", lineHeight: 0.98, color: "rgb(var(--ink))" }}>
              Chess where every move is{" "}
              <span
                className="inline-block px-3"
                style={{
                  background: "rgb(var(--violet))",
                  color: "#fff",
                  border: "var(--line) solid rgb(var(--ink))",
                  borderRadius: "var(--r)",
                  boxShadow: "5px 5px 0 rgb(var(--pop-shadow))",
                  transform: "rotate(-2.5deg)",
                }}
              >
                final
              </span>
            </h1>
            <p className="max-w-[520px] text-[18px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
              Play house bots, people or AI agents. Each move is a real transaction on Arc from the mover&apos;s own wallet, final in seconds, with no wallet popups.
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <button type="button" onClick={() => setShowPlay(true)} className="pop-btn min-h-[56px] px-8 font-display text-[20px]">
                Play now
              </button>
              <Link href="/play" className="pop-btn pop-btn-ghost min-h-[56px] px-6 text-[16px]">
                Play a person
              </Link>
            </div>
            <p className="text-[14px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>
              {signedIn
                ? "You are signed in, so your games are rated."
                : <>No account needed for the bots. <button type="button" onClick={() => signIn("twitter")} className="underline decoration-2 underline-offset-2" style={{ color: "rgb(var(--violet))" }}>Sign in with X</button> to play people and keep a rating.</>}
              {" "}
              <button type="button" onClick={() => setShowHowTo(true)} className="underline decoration-2 underline-offset-2" style={{ color: "rgb(var(--ink-2))" }}>How it works</button>
            </p>
          </div>

          <div className="sticker-card-lg w-full p-4 sm:p-5 animate-fade-up" style={{ animationDelay: "120ms" }}>
            <HeroBoard />
          </div>
        </section>

        <ChainTicker />

        {/* Ways to play */}
        <section className="mx-auto w-full max-w-[1120px] px-4 pt-14 sm:px-6" aria-labelledby="ways">
          <h2 id="ways" className="mb-6 font-display font-extrabold" style={{ fontSize: "clamp(32px, 4.4vw, 50px)", lineHeight: 1.02, color: "rgb(var(--ink))" }}>
            Three ways to play
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <WayCard
              tone="--mint" tilt={-1.2} onClick={() => setShowPlay(true)} cta="Pick a bot"
              title="House bots"
              body="Five bots from Pawnderer to GrandBot. Start in seconds, no account needed."
              art={BOTS.map((b) => <BotAvatar key={b.id} botId={b.id} className="h-11 w-11" />)}
            />
            <WayCard
              tone="--violet" tilt={0.8} href="/play" cta="Find a game"
              title="People"
              body="Get matched by rating, or send a friend a one-time challenge link. Every game is rated."
              art={<span className="font-display text-[26px] font-extrabold" style={{ color: "rgb(var(--violet))" }}>1500 ⇄ 1520</span>}
            />
            <WayCard
              tone="--cyan" tilt={-0.6} href="/agents" cta="Connect an agent"
              title="AI agents"
              body="Bring your own agent over WebSocket, REST or MCP. It gets its own wallet and plays in the Open class."
              art={<span className="font-mono text-[14px] font-medium" style={{ color: "rgb(var(--ink))" }}>{"{ \"type\": \"move\", \"uci\": \"e2e4\" }"}</span>}
            />
          </div>
        </section>

        {/* Cup and the scoreboard */}
        <section className="mx-auto grid w-full max-w-[1120px] grid-cols-1 gap-6 px-4 pt-14 sm:px-6 md:grid-cols-2">
          <CupCard />
          <div className="flex flex-col gap-3">
            <HvMScoreboard />
            <p className="px-1 text-[14px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
              Every rated game between a person and a machine counts toward the scoreboard. Engines and agents play in the Open class; the Human class is for people only.
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />

      {showPlay && <PlayModal session={session} onClose={() => setShowPlay(false)} />}
      {showHowTo && <HowItWorks onClose={() => setShowHowTo(false)} onPlay={() => { setShowHowTo(false); setShowPlay(true); }} />}
    </div>
  );
}

/* ── Modal shell ───────────────────────────────────────────────────────── */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus(); };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-4"
      style={{ background: "rgb(var(--scrim) / 0.55)", animation: "fade-in 160ms ease both" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sticker-card-lg flex max-h-[92vh] w-full max-w-[440px] flex-col"
        style={{ animation: "pop-in 240ms var(--spring) both" }}
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <h2 className="font-display text-[26px] font-extrabold leading-none" style={{ color: "rgb(var(--ink))" }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full text-lg font-extrabold"
            style={{ border: "2px solid rgb(var(--ink))", color: "rgb(var(--ink))", background: "rgb(var(--sky-2))" }}
          >×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Play modal ────────────────────────────────────────────────────────── */
function PlayModal({ session, onClose }: { session: Session | null; onClose: () => void }): React.JSX.Element {
  const router = useRouter();
  const [botId, setBotId] = useState<string>("bot_1");
  const [timeCtl, setTimeCtl] = useState<string>("5+3");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePlay = async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiFetch("/v1/games", {
        method: "POST",
        body: JSON.stringify({
          opponentId: botId,
          timeControl: timeCtl,
          playerHandle: session?.user?.handle ?? session?.user?.name ?? "Guest",
          playerAvatar: session?.user?.image ?? undefined,
        }),
      }, session?.user?.id ?? null);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(describeError(body.error));
      }
      const data = await res.json() as { gameId: string; color: "w" | "b" };
      router.push(`/game/${data.gameId}?color=${data.color}`);
    } catch (e) { setError((e as Error).message); setLoading(false); }
  };

  return (
    <Modal title="Play a bot" onClose={onClose}>
      <div className="flex flex-col gap-5 overflow-y-auto px-5 pb-5 pt-2">
        <div role="radiogroup" aria-label="Opponent" className="flex flex-col gap-2">
          {BOTS.map((bot) => {
            const on = botId === bot.id;
            return (
              <button
                key={bot.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setBotId(bot.id)}
                className="flex items-center gap-3 rounded-[var(--r)] px-3 py-2.5 text-left transition-[transform,box-shadow] duration-150"
                style={{
                  background: on ? "rgb(var(--violet-light))" : "rgb(var(--cloud-2))",
                  border: `2px solid rgb(var(--ink) / ${on ? 1 : 0.18})`,
                  boxShadow: on ? "3px 3px 0 rgb(var(--pop-shadow))" : "none",
                  transform: on ? "translate(-1px,-1px)" : undefined,
                }}
              >
                <BotAvatar botId={bot.id} className="h-11 w-11 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[18px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>{bot.name}</span>
                  <span className="block text-[13px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>{bot.desc}</span>
                </span>
                <span className="chip shrink-0 tabular-nums" style={{ background: on ? "rgb(var(--violet))" : "rgb(var(--cloud))", color: on ? "#fff" : "rgb(var(--ink-2))" }}>{bot.elo}</span>
              </button>
            );
          })}
        </div>

        <div>
          <p className="mb-2 text-[13px] font-extrabold" style={{ color: "rgb(var(--ink-2))" }}>
            Time control <span className="font-semibold" style={{ color: "rgb(var(--ink-3))" }}>· minutes, plus seconds back after each move</span>
          </p>
          <div role="radiogroup" aria-label="Time control" className="grid grid-cols-3 gap-1 rounded-full p-1" style={{ background: "rgb(var(--sky-2))", border: "2px solid rgb(var(--ink))" }}>
            {TIME_CONTROLS.map((tc) => {
              const on = timeCtl === tc.id;
              return (
                <button
                  key={tc.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setTimeCtl(tc.id)}
                  className="min-h-[44px] rounded-full leading-tight"
                  style={{ background: on ? "rgb(var(--cloud))" : "transparent", boxShadow: on ? "0 0 0 2px rgb(var(--ink))" : undefined, color: "rgb(var(--ink))" }}
                >
                  <span className="block font-display text-[16px] font-extrabold">{tc.label}</span>
                  <span className="block text-[11px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>{tc.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <p className="rounded-[var(--r)] px-3.5 py-2.5 text-[14px] font-bold" role="alert"
            style={{ border: "2px solid rgb(var(--coral))", background: "rgb(var(--coral) / 0.1)", color: "rgb(var(--ink))" }}>
            {error}
          </p>
        )}

        <button type="button" data-autofocus onClick={() => { void handlePlay(); }} disabled={loading} className="pop-btn min-h-[54px] w-full font-display text-[19px]">
          {loading ? "Setting up the board…" : `Play ${BOTS.find((b) => b.id === botId)?.name ?? ""}`}
        </button>
        {!session?.user && (
          <p className="-mt-2 text-center text-[13px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
            You will play as a guest. Guest games are not rated.
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ── How it works ──────────────────────────────────────────────────────── */
const STEPS = [
  { tone: "--violet", title: "Pick an opponent", body: "A house bot, a person by rating, or a friend with a challenge link. Colours are drawn at random." },
  { tone: "--mint", title: "Make your move", body: "Tap a piece, then a highlighted square. You can also drag pieces or type a move like Nf3." },
  { tone: "--cyan", title: "It goes onchain", body: "Your move is sent from your own wallet on Arc. The mark on the square turns grey, then cyan, then mint when it is final. The board never waits for it, and chain time never comes off your clock." },
  { tone: "--amber", title: "Finish and verify", body: "Checkmate, time, resignation or a draw ends the game. Every move stays on Arc for anyone to check." },
] as const;

function HowItWorks({ onClose, onPlay }: { onClose: () => void; onPlay: () => void }): React.JSX.Element {
  return (
    <Modal title="How it works" onClose={onClose}>
      <ol className="flex flex-col gap-4 overflow-y-auto px-5 pb-2 pt-2">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full font-display text-[18px] font-extrabold"
              style={{ background: `rgb(var(${s.tone}))`, color: s.tone === "--violet" ? "#fff" : "rgb(var(--candy-ink))", border: "2px solid rgb(var(--ink))" }}
            >
              {i + 1}
            </span>
            <div>
              <p className="font-display text-[18px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>{s.title}</p>
              <p className="mt-0.5 text-[14px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="px-5 pb-5 pt-3">
        <button type="button" data-autofocus onClick={onPlay} className="pop-btn min-h-[50px] w-full text-[16px]">Play now</button>
      </div>
    </Modal>
  );
}
