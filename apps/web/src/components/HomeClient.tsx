"use client";
import type React from "react";
import { useState } from "react";
import Link from "next/link";
import type { Session } from "next-auth";
import { signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { getGuestId } from "@/lib/utils";
import { HvMScoreboard } from "@/components/HvMScoreboard";
import { BotAvatar } from "@/components/BotAvatar";
import { ThemeToggle } from "@/components/ThemeToggle";

const BOT_LEVELS = [
  { id: "bot_1", name: "Pawnderer",  desc: "Perfect for beginners",       elo: "~600" },
  { id: "bot_2", name: "Knightfall", desc: "A bit unpredictable",          elo: "~900" },
  { id: "bot_3", name: "Rookery",    desc: "Solid, steady play",           elo: "~1200" },
  { id: "bot_4", name: "Bishopric",  desc: "Tactical awareness",           elo: "~1500" },
  { id: "bot_5", name: "GrandBot",   desc: "Relentless engine strength",   elo: "~1900" },
] as const;

const TIME_CONTROLS = [
  { id: "3+2",  label: "3 + 2",  desc: "Blitz" },
  { id: "5+3",  label: "5 + 3",  desc: "Blitz" },
  { id: "10+5", label: "10 + 5", desc: "Rapid" },
] as const;

interface Props { session: Session | null; }

/* ── floating chess-piece SVGs ─────────────────────────────────────────── */
function FloatPiece({ path, cls, style }: { path: string; cls: string; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 45 45"
      xmlns="http://www.w3.org/2000/svg"
      className={`absolute pointer-events-none select-none ${cls}`}
      style={style}
      aria-hidden
    >
      <path
        d={path}
        fill="rgb(var(--teal))"
        stroke="rgb(var(--ink))"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.22"
      />
    </svg>
  );
}

/* Chess piece paths (simplified outlines) */
const PIECE_PATHS = {
  king:   "M22.5 11.63V6M20 8h5M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5zM11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V17s-5 1-5 6 3.5 5 3.5 5v7z",
  knight: "M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18",
  rook:   "M 9,39 L 36,39 L 36,36 L 9,36 L 9,39 z M 12,36 L 12,32 L 33,32 L 33,36 L 12,36 z M 11,14 L 11,9 L 15,9 L 15,11 L 20,11 L 20,9 L 25,9 L 25,11 L 30,11 L 30,9 L 34,9 L 34,14",
  bishop: "M 9,36 C 12.39,35.03 19.11,36.43 22.5,34 C 25.89,36.43 32.61,35.03 36,36 C 36,36 37.65,36.54 39,38 C 38.32,38.97 37.35,38.99 36,38.5 C 32.61,37.53 25.89,38.96 22.5,37.5 C 19.11,38.96 12.39,37.53 9,38.5 C 7.65,38.99 6.68,38.97 6,38 C 7.35,36.54 9,36 9,36 z M 15,32 C 17.5,34.5 27.5,34.5 30,32 C 30.5,30.5 30,30 30,30 C 30,27.5 27.5,26 27.5,26 L 22.5,10.5 L 17.5,26 C 17.5,26 15,27.5 15,30 C 15,30 14.5,30.5 15,32 z",
  pawn:   "M 22.5,9 C 20.29,9 18.5,10.79 18.5,13 C 18.5,13.89 18.81,14.71 19.33,15.35 C 18.63,16.29 18,17.56 18,19 C 18,20.93 18.92,22.64 20.33,23.77 C 19.04,24.62 15,26.44 15,37 L 30,37 C 30,26.44 25.96,24.62 24.67,23.77 C 26.08,22.64 27,20.93 27,19 C 27,17.56 26.37,16.29 25.67,15.35 C 26.19,14.71 26.5,13.89 26.5,13 C 26.5,10.79 24.71,9 22.5,9 z",
};

/* ── Animated background board grid ────────────────────────────────────── */
function BoardGrid() {
  const cells = Array.from({ length: 64 }, (_, i) => i);
  const isDark = (i: number) => Math.floor(i / 8) % 2 === i % 2;
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden>
      {/* Board grid */}
      <div
        className="absolute animate-board"
        style={{
          top: "50%", left: "50%",
          width: 360, height: 360,
          transform: "translate(-50%, -50%) rotate(12deg)",
          display: "grid",
          gridTemplateColumns: "repeat(8, 1fr)",
          borderRadius: 8,
          overflow: "hidden",
          opacity: 0.09,
        }}
      >
        {cells.map((i) => (
          <div
            key={i}
            style={{
              background: isDark(i)
                ? "rgb(var(--ink))"
                : "rgb(var(--teal))",
            }}
          />
        ))}
      </div>

      {/* Floating pieces */}
      <FloatPiece path={PIECE_PATHS.king}   cls="w-20 h-20 animate-float-a" style={{ top: "8%",  left: "4%"  }} />
      <FloatPiece path={PIECE_PATHS.knight} cls="w-14 h-14 animate-float-b" style={{ top: "12%", right: "6%" }} />
      <FloatPiece path={PIECE_PATHS.rook}   cls="w-16 h-16 animate-float-c" style={{ bottom: "18%", left: "7%"  }} />
      <FloatPiece path={PIECE_PATHS.bishop} cls="w-12 h-12 animate-float-d" style={{ bottom: "22%", right: "5%" }} />
      <FloatPiece path={PIECE_PATHS.pawn}   cls="w-10 h-10 animate-float-a" style={{ top: "42%",  left: "2%"  }} />
      <FloatPiece path={PIECE_PATHS.pawn}   cls="w-10 h-10 animate-float-b" style={{ top: "38%",  right: "3%" }} />
    </div>
  );
}

/* ── Scrolling chain-status ticker ─────────────────────────────────────── */
function ChainTicker() {
  const items = [
    "e2→e4  confirmed ✓",
    "d7→d5  confirmed ✓",
    "g1→f3  confirmed ✓",
    "c7→c5  confirmed ✓",
    "f1→b5  confirmed ✓",
    "a7→a6  confirmed ✓",
    "b5→a4  confirmed ✓",
    "b7→b5  confirmed ✓",
  ];
  const doubled = [...items, ...items]; // seamless loop
  return (
    <div
      className="w-full overflow-hidden border-y-2 py-2"
      style={{ borderColor: "rgb(var(--ink) / 0.10)", background: "rgb(var(--teal-light))" }}
    >
      <div className="flex gap-6 animate-chain-scroll whitespace-nowrap" style={{ width: "max-content" }}>
        {doubled.map((item, i) => (
          <span
            key={i}
            className="font-mono text-[11px] font-bold"
            style={{ color: "rgb(var(--teal-deep))" }}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Main HomeClient ────────────────────────────────────────────────────── */
export function HomeClient({ session }: Props): React.JSX.Element {
  const [showPlay,   setShowPlay]   = useState(false);
  const [showHowTo,  setShowHowTo]  = useState(false);

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: "rgb(var(--sky))" }}>
      <BoardGrid />

      {/* Nav */}
      <header
        className="relative z-10 flex items-center justify-between px-5 py-3 border-b-2"
        style={{ borderColor: "rgb(var(--ink) / 0.10)", background: "rgb(var(--cloud) / 0.80)", backdropFilter: "blur(8px)" }}
      >
        <span className="font-display font-extrabold text-xl tracking-tight" style={{ color: "rgb(var(--ink))" }}>
          Final Move
        </span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {session?.user ? (
            <>
              <span className="text-sm font-semibold hidden sm:block" style={{ color: "rgb(var(--ink-2))" }}>
                @{session.user.handle ?? session.user.name}
              </span>
              <button onClick={() => signOut()} className="pop-btn-ghost pop-btn rounded-full px-4 py-1.5 text-xs">
                Sign out
              </button>
            </>
          ) : (
            <button onClick={() => signIn("twitter")} className="pop-btn rounded-full px-4 py-1.5 text-sm">
              Sign in with X
            </button>
          )}
        </div>
      </header>

      {/* Chain ticker */}
      <div className="relative z-10">
        <ChainTicker />
      </div>

      {/* Hero */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-8 gap-4 max-w-sm mx-auto w-full text-center">

        {/* Logo sticker card — staggered entrance */}
        <div className="sticker-card-lg w-full px-6 py-7 animate-fade-up delay-0">
          <div className="flex justify-center mb-3">
            <svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" className="w-14 h-14" aria-hidden>
              <g strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path fill="rgb(var(--teal))" stroke="rgb(var(--ink))"
                  d="M22.5 11.63V6M20 8h5M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5z" />
                <path fill="rgb(var(--teal))" stroke="rgb(var(--ink))"
                  d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V17s-5 1-5 6 3.5 5 3.5 5v7z" />
                <path fill="none" stroke="rgb(var(--teal-light))"
                  d="M11.5 30c5.5-3 15.5-3 21 0M11.5 33.5c5.5-3 15.5-3 21 0M11.5 37c5.5-3 15.5-3 21 0" />
              </g>
            </svg>
          </div>
          <div className="font-display text-4xl font-extrabold tracking-tight mb-2" style={{ color: "rgb(var(--ink))" }}>
            Final Move
          </div>
          <p className="text-sm font-medium leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
            Every move is a transaction on Arc.<br />Chess that lives onchain, forever.
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2.5 w-full animate-fade-up delay-100">
          {[
            { label: "Moves onchain", value: "Every" },
            { label: "Block time",    value: "< 1s"  },
            { label: "Gas token",     value: "USDC"  },
          ].map((s) => (
            <div key={s.label} className="sticker-card-sm p-3 text-center">
              <div className="font-display text-base font-extrabold" style={{ color: "rgb(var(--teal))" }}>{s.value}</div>
              <div className="text-[10px] mt-0.5 leading-tight font-semibold" style={{ color: "rgb(var(--ink-3))" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* CTAs */}
        <div className="w-full flex flex-col gap-2.5 animate-fade-up delay-200">
          <button
            onClick={() => setShowPlay(true)}
            className="pop-btn w-full rounded-2xl py-3.5 font-display text-lg font-extrabold tracking-tight"
          >
            Play now
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setShowHowTo(true)}
              className="pop-btn-ghost pop-btn rounded-2xl py-2.5 font-display text-sm font-bold"
            >
              How to play
            </button>
            <a
              href="/play"
              className="pop-btn-ghost pop-btn rounded-2xl py-2.5 font-display text-sm font-bold"
            >
              vs Human
            </a>
          </div>
        </div>

        {/* HvM scoreboard */}
        <div className="w-full animate-fade-up delay-300">
          <HvMScoreboard />
        </div>

        <div className="flex items-center gap-4 animate-fade-up delay-400">
          <Link href="/leaderboard" className="text-sm font-bold hover:underline" style={{ color: "rgb(var(--teal))" }}>
            Leaderboard →
          </Link>
          <span style={{ color: "rgb(var(--ink-3))" }}>·</span>
          <Link href="/about" className="text-xs font-semibold hover:underline" style={{ color: "rgb(var(--ink-3))" }}>
            About &amp; fair play
          </Link>
        </div>

        {!session?.user && (
          <p className="text-xs font-medium animate-fade-in delay-500" style={{ color: "rgb(var(--ink-3))" }}>
            Sign in with X to save your rating. Guest play available below.
          </p>
        )}
      </main>

      {showPlay  && <PlayModal    session={session} onClose={() => setShowPlay(false)} />}
      {showHowTo && <HowToPlayModal                 onClose={() => setShowHowTo(false)} />}
    </div>
  );
}

/* ── Play modal ─────────────────────────────────────────────────────────── */
function PlayModal({ session, onClose }: { session: Session | null; onClose: () => void }): React.JSX.Element {
  const router = useRouter();
  const [botId,   setBotId]   = useState<string>("bot_1");
  const [timeCtl, setTimeCtl] = useState<string>("3+2");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const handlePlay = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/v1/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opponentId:   botId,
          timeControl:  timeCtl,
          playerId:     session?.user?.id ?? getGuestId(),
          playerHandle: session?.user?.handle ?? session?.user?.name ?? "Guest",
          playerAvatar: session?.user?.image ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? "Failed to create game");
      }
      const data = await res.json() as { gameId: string; playerId: string; color: "w" | "b" };
      router.push(`/game/${data.gameId}?pid=${data.playerId}&color=${data.color}`);
    } catch (e) { setError((e as Error).message); setLoading(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgb(var(--scrim) / 0.55)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="sticker-card-lg w-full max-w-sm animate-[drop-in_0.2s_ease-out]"
        style={{ background: "rgb(var(--cloud))" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b-2" style={{ borderColor: "rgb(var(--ink) / 0.10)" }}>
          <span className="font-display font-extrabold text-base" style={{ color: "rgb(var(--ink))" }}>New game</span>
          <button
            onClick={onClose}
            className="rounded-full h-7 w-7 flex items-center justify-center text-sm font-extrabold border-2 transition-all hover:scale-110"
            style={{ borderColor: "rgb(var(--ink))", color: "rgb(var(--ink))", background: "rgb(var(--sky-2))" }}
          >×</button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {/* Time control */}
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-widest mb-2.5 font-display" style={{ color: "rgb(var(--ink-3))" }}>
              Time control
              <button
                onClick={() => {/* inline tooltip handled below */}}
                className="ml-2 inline-flex items-center justify-center rounded-full w-4 h-4 text-[9px] font-extrabold border"
                style={{ borderColor: "rgb(var(--ink-3))", color: "rgb(var(--ink-3))", verticalAlign: "middle" }}
                title="Minutes on clock + seconds added back after each move"
              >?</button>
            </p>
            <p className="text-[10px] font-semibold mb-2" style={{ color: "rgb(var(--ink-3))" }}>
              Minutes + seconds added per move
            </p>
            <div className="grid grid-cols-3 gap-2">
              {TIME_CONTROLS.map((tc) => (
                <button
                  key={tc.id}
                  onClick={() => setTimeCtl(tc.id)}
                  className="rounded-2xl py-2.5 text-center text-sm font-bold border-2 transition-all"
                  style={{
                    borderColor: timeCtl === tc.id ? "rgb(var(--teal))"        : "rgb(var(--ink) / 0.15)",
                    background:  timeCtl === tc.id ? "rgb(var(--teal-light))"  : "rgb(var(--cloud-2))",
                    color:       timeCtl === tc.id ? "rgb(var(--teal-deep))"   : "rgb(var(--ink))",
                    boxShadow:   timeCtl === tc.id ? "3px 3px 0 rgb(var(--teal-light))" : "none",
                  }}
                >
                  <div className="font-display font-extrabold">{tc.label}</div>
                  <div className="text-[10px] font-semibold opacity-70 mt-0.5">{tc.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Bot level */}
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-widest mb-2.5 font-display" style={{ color: "rgb(var(--ink-3))" }}>
              Play against
            </p>
            <div className="flex flex-col gap-1.5">
              {BOT_LEVELS.map((bot) => (
                <button
                  key={bot.id}
                  onClick={() => setBotId(bot.id)}
                  className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left border-2 transition-all"
                  style={{
                    borderColor: botId === bot.id ? "rgb(var(--teal))"       : "rgb(var(--ink) / 0.12)",
                    background:  botId === bot.id ? "rgb(var(--teal-light))" : "rgb(var(--cloud-2))",
                    boxShadow:   botId === bot.id ? "3px 3px 0 rgb(var(--teal-light))" : "none",
                  }}
                >
                  <BotAvatar className="w-9 h-9 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold font-display" style={{ color: "rgb(var(--ink))" }}>{bot.name}</div>
                    <div className="text-[11px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>{bot.desc}</div>
                  </div>
                  <span className="chip text-[10px] shrink-0" style={{ color: "rgb(var(--ink-3))" }}>{bot.elo}</span>
                  {botId === bot.id && (
                    <span className="chip ml-1" style={{ background: "rgb(var(--teal))", color: "#fff", borderColor: "rgb(var(--ink))" }}>
                      Selected
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded-2xl px-3.5 py-2.5 text-xs font-bold border-2"
              style={{ borderColor: "rgb(var(--danger))", background: "rgb(var(--danger) / 0.08)", color: "rgb(var(--danger))" }}>
              {error}
            </p>
          )}

          <button
            onClick={() => { void handlePlay(); }}
            disabled={loading}
            className="pop-btn w-full rounded-2xl py-3 font-display text-base font-extrabold"
          >
            {loading ? "Creating…" : "Play"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── How To Play modal ──────────────────────────────────────────────────── */
const HOW_TO_STEPS = [
  {
    num: "1",
    title: "Pick a bot and time control",
    body: "Choose your opponent (Pawnderer is easiest) and how long each player gets. 3+2 means 3 minutes on the clock, plus 2 seconds added after every move you make.",
    accent: "--teal",
  },
  {
    num: "2",
    title: "Move a piece",
    body: "Tap a piece to see its legal moves highlighted in teal. Tap a highlighted square to move there. You play as white or black — assigned randomly.",
    accent: "--mint",
  },
  {
    num: "3",
    title: "Your move goes onchain",
    body: "Every move is submitted as a transaction on Arc — a blockchain where USDC is the gas token. The chain rail on the right shows: queued → sent → confirmed.",
    accent: "--amber",
  },
  {
    num: "4",
    title: "Win, draw, or lose",
    body: "Checkmate, timeout, or resignation ends the game. Your rating (TrueSkill) updates if you are signed in. Guest games are not rated.",
    accent: "--coral",
  },
  {
    num: "5",
    title: "Sign in to keep your rating",
    body: "Sign in with X to save your rating across sessions, appear on the leaderboard, and challenge human opponents. Guest play is always available.",
    accent: "--sky-blue",
  },
] as const;

const TIME_EXPLAINER = [
  { label: "3 + 2", cat: "Blitz",  detail: "3 min clock · +2 s/move · Fast and tactical" },
  { label: "5 + 3", cat: "Blitz",  detail: "5 min clock · +3 s/move · Standard online blitz" },
  { label: "10 + 5", cat: "Rapid", detail: "10 min clock · +5 s/move · More time to think" },
] as const;

function HowToPlayModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<"guide" | "time" | "chain">("guide");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgb(var(--scrim) / 0.60)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="sticker-card-lg w-full max-w-sm max-h-[88vh] flex flex-col animate-[drop-in_0.22s_ease-out]"
        style={{ background: "rgb(var(--cloud))" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b-2 shrink-0" style={{ borderColor: "rgb(var(--ink) / 0.10)" }}>
          <span className="font-display font-extrabold text-base" style={{ color: "rgb(var(--ink))" }}>How to play</span>
          <button
            onClick={onClose}
            className="rounded-full h-7 w-7 flex items-center justify-center text-sm font-extrabold border-2 transition-all hover:scale-110"
            style={{ borderColor: "rgb(var(--ink))", color: "rgb(var(--ink))", background: "rgb(var(--sky-2))" }}
          >×</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 pb-1 shrink-0">
          {([["guide", "Guide"], ["time", "Time controls"], ["chain", "Onchain"]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="rounded-full px-3 py-1 text-xs font-bold border-2 transition-all"
              style={{
                borderColor: tab === id ? "rgb(var(--teal))"       : "rgb(var(--ink) / 0.15)",
                background:  tab === id ? "rgb(var(--teal-light))" : "transparent",
                color:       tab === id ? "rgb(var(--teal-deep))"  : "rgb(var(--ink-3))",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* ── Guide tab ── */}
          {tab === "guide" && (
            <ol className="flex flex-col gap-3">
              {HOW_TO_STEPS.map((step, i) => (
                <li
                  key={step.num}
                  className={`relative flex gap-3 pb-3 ${i < HOW_TO_STEPS.length - 1 ? "htpl-step" : ""}`}
                >
                  {/* Number bubble */}
                  <span
                    className="w-10 h-10 shrink-0 rounded-full border-2 flex items-center justify-center font-display font-extrabold text-sm"
                    style={{
                      background:  `rgb(var(${step.accent}) / 0.18)`,
                      borderColor: `rgb(var(${step.accent}))`,
                      color:       `rgb(var(${step.accent}))`,
                      zIndex:      1,
                    }}
                  >
                    {step.num}
                  </span>
                  <div className="flex-1 pt-1">
                    <p className="font-display font-extrabold text-sm mb-1" style={{ color: "rgb(var(--ink))" }}>
                      {step.title}
                    </p>
                    <p className="text-xs font-medium leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {/* ── Time controls tab ── */}
          {tab === "time" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs font-semibold leading-relaxed mb-1" style={{ color: "rgb(var(--ink-2))" }}>
                The format is <strong>minutes + increment</strong>. After each move, the increment is added back to your clock — so short moves never cost you time.
              </p>
              {TIME_EXPLAINER.map((tc) => (
                <div key={tc.label} className="sticker-card-sm p-4 flex items-start gap-3">
                  <span
                    className="font-display font-extrabold text-lg shrink-0 w-14 text-center"
                    style={{ color: "rgb(var(--teal))" }}
                  >
                    {tc.label}
                  </span>
                  <div>
                    <span className="chip text-[10px] mb-1">{tc.cat}</span>
                    <p className="text-xs font-semibold mt-1" style={{ color: "rgb(var(--ink-2))" }}>{tc.detail}</p>
                  </div>
                </div>
              ))}
              <div className="sticker-card-sm p-4" style={{ background: "rgb(var(--amber) / 0.10)", borderColor: "rgb(var(--amber))" }}>
                <p className="text-xs font-bold" style={{ color: "rgb(var(--ink))" }}>New to chess?</p>
                <p className="text-xs font-medium mt-1" style={{ color: "rgb(var(--ink-2))" }}>
                  Start with 5+3 — it gives you enough time to think without games dragging on too long.
                </p>
              </div>
            </div>
          )}

          {/* ── Onchain tab ── */}
          {tab === "chain" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
                Final Move runs on <strong>Arc</strong>, a blockchain where USDC is the native gas token. Every move you make is a real transaction — permanent, public, and verifiable.
              </p>

              {/* Chain rail explainer */}
              {[
                { state: "Queued",    color: "--teal-light", ink: "--ink-3",   desc: "Move accepted by the server. Waiting for the next block." },
                { state: "Sent",      color: "--amber",       ink: "--candy-ink", desc: "Transaction broadcast to Arc. Waiting for confirmation." },
                { state: "Confirmed", color: "--teal",        ink: "--cloud",   desc: "Move permanently recorded onchain. Block finalized." },
              ].map((s) => (
                <div key={s.state} className="sticker-card-sm p-3 flex items-start gap-3">
                  <span
                    className="rounded-full border-2 px-2.5 py-0.5 text-[11px] font-extrabold shrink-0 mt-0.5"
                    style={{ background: `rgb(var(${s.color}))`, borderColor: "rgb(var(--ink))", color: `rgb(var(${s.ink}))` }}
                  >
                    {s.state}
                  </span>
                  <p className="text-xs font-medium leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
                    {s.desc}
                  </p>
                </div>
              ))}

              <div className="sticker-card-sm p-4" style={{ background: "rgb(var(--teal-light))" }}>
                <p className="text-xs font-bold mb-1" style={{ color: "rgb(var(--ink))" }}>What it costs</p>
                <p className="text-xs font-medium" style={{ color: "rgb(var(--ink-2))" }}>
                  Each move uses a tiny amount of USDC for gas (fractions of a cent). The referee wallet covers gas for new players — you need no wallet to play as a guest.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer CTA */}
        <div className="px-5 py-4 border-t-2 shrink-0" style={{ borderColor: "rgb(var(--ink) / 0.10)" }}>
          <button
            onClick={onClose}
            className="pop-btn w-full rounded-2xl py-3 font-display font-extrabold text-sm"
          >
            Got it — Play now
          </button>
        </div>
      </div>
    </div>
  );
}
