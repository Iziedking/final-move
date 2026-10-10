"use client";
import type React from "react";
/**
 * Home page: hero board demo, Play button, sign-in.
 * PlayModal handles time control + bot level selection + game creation.
 */
import { useState } from "react";
import type { Session } from "next-auth";
import { signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { cx } from "@/lib/utils";

const BOT_LEVELS = [
  { id: "bot_1", name: "Pawnderer",  desc: "Perfect for beginners" },
  { id: "bot_2", name: "Knightfall", desc: "A bit unpredictable" },
  { id: "bot_3", name: "Rookery",    desc: "Solid, steady play" },
  { id: "bot_4", name: "Bishopric",  desc: "Tactical awareness" },
  { id: "bot_5", name: "GrandBot",   desc: "Relentless engine strength" },
] as const;

const TIME_CONTROLS = [
  { id: "3+2",  label: "3 + 2",  desc: "Blitz" },
  { id: "5+3",  label: "5 + 3",  desc: "Blitz" },
  { id: "10+5", label: "10 + 5", desc: "Rapid" },
] as const;

interface Props {
  session: Session | null;
}

export function HomeClient({ session }: Props) {
  const [showPlay, setShowPlay] = useState(false);

  return (
    <div className="min-h-screen bg-sky flex flex-col">
      {/* Nav */}
      <header className="flex items-center justify-between px-4 py-3 border-b-[3px] border-ink bg-cloud shadow-pop-press">
        <span className="font-display font-bold text-xl text-ink">Final Move</span>
        <div className="flex items-center gap-2">
          {session?.user ? (
            <>
              <span className="font-body text-sm text-ink-2 hidden sm:block">
                @{session.user.handle ?? session.user.name}
              </span>
              <button
                onClick={() => signOut()}
                className="rounded-pill border-[2px] border-ink bg-cloud-2 px-3 py-1 text-[12px] font-bold text-ink shadow-pop-press hover:bg-cloud transition-colors"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              onClick={() => signIn("twitter")}
              className="rounded-pill border-[2px] border-ink bg-violet px-4 py-1.5 text-[12px] font-bold text-cloud shadow-pop hover:shadow-pop-press transition-all"
            >
              Sign in with X
            </button>
          )}
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 gap-6 max-w-md mx-auto w-full text-center">
        {/* Logo / tagline */}
        <div className="rounded-chunk border-[3px] border-ink bg-cloud p-6 shadow-pop-lg w-full">
          <div className="font-display text-4xl font-bold text-ink mb-2">♟ Final Move</div>
          <p className="font-body text-[14px] text-ink-2 leading-relaxed">
            Every move is a transaction on Arc.
            <br />Chess that lives on chain — forever.
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {[
            { label: "Moves on chain", value: "∞" },
            { label: "Block time", value: "< 1s" },
            { label: "Gas token", value: "USDC" },
          ].map((s) => (
            <div key={s.label} className="rounded-chunk border-[3px] border-ink bg-cloud p-3 shadow-pop text-center">
              <div className="font-display text-xl font-bold text-violet">{s.value}</div>
              <div className="font-body text-[10px] text-ink-3 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Play button */}
        <button
          onClick={() => setShowPlay(true)}
          className="w-full rounded-chunk border-[3px] border-ink bg-violet py-4 font-display text-xl font-bold text-cloud shadow-pop hover:shadow-pop-press active:shadow-pop-press transition-all"
        >
          Play now
        </button>

        {/* Human vs human */}
        <a
          href="/play"
          className="w-full rounded-chunk border-[3px] border-ink bg-cloud py-3 font-display text-base font-bold text-ink shadow-pop hover:shadow-pop-press active:shadow-pop-press transition-all text-center"
        >
          Find a human opponent
        </a>

        <a
          href="/leaderboard"
          className="font-body text-[13px] text-violet font-bold hover:underline transition-colors"
        >
          View leaderboard →
        </a>

        {!session?.user && (
          <p className="font-body text-[12px] text-ink-3">
            Sign in with X to save your rating. Guest play available below.
          </p>
        )}
      </main>

      {/* Play modal */}
      {showPlay && (
        <PlayModal session={session} onClose={() => setShowPlay(false)} />
      )}
    </div>
  );
}

function PlayModal({ session, onClose }: { session: Session | null; onClose: () => void }): React.JSX.Element {
  const router = useRouter();
  const [botId, setBotId]     = useState<string>("bot_1");
  const [timeCtl, setTimeCtl] = useState<string>("3+2");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handlePlay = async () => {
    setLoading(true);
    setError(null);
    try {
      const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
      const res = await fetch(`${serverUrl}/v1/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opponentId: botId,
          timeControl: timeCtl,
          playerId: session?.user?.id ?? "guest",
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
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(var(--scrim) / 0.7)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-chunk border-[3px] border-ink bg-cloud shadow-pop-lg animate-[drop-in_0.2s_ease-out]">
        <div className="flex items-center justify-between border-b-[3px] border-ink px-4 py-3">
          <span className="font-display font-bold text-lg text-ink">New game</span>
          <button onClick={onClose} className="rounded-full h-7 w-7 border-[2px] border-ink bg-cloud-2 text-ink font-bold shadow-pop-press hover:bg-cloud">✕</button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {/* Time control */}
          <div>
            <p className="font-body font-bold text-[13px] text-ink mb-2">Time control</p>
            <div className="grid grid-cols-3 gap-2">
              {TIME_CONTROLS.map((tc) => (
                <button
                  key={tc.id}
                  onClick={() => setTimeCtl(tc.id)}
                  className={cx(
                    "rounded-chunk border-[2px] border-ink py-2 text-center font-display font-bold text-[13px] transition-all shadow-pop-press",
                    timeCtl === tc.id ? "bg-violet text-cloud" : "bg-cloud-2 text-ink hover:bg-cloud",
                  )}
                >
                  <div>{tc.label}</div>
                  <div className="text-[10px] font-body font-normal opacity-70">{tc.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Bot level */}
          <div>
            <p className="font-body font-bold text-[13px] text-ink mb-2">Play against</p>
            <div className="flex flex-col gap-1.5">
              {BOT_LEVELS.map((bot) => (
                <button
                  key={bot.id}
                  onClick={() => setBotId(bot.id)}
                  className={cx(
                    "flex items-center gap-3 rounded-chunk border-[2px] border-ink px-3 py-2 text-left transition-all shadow-pop-press",
                    botId === bot.id ? "bg-violet/15 border-violet" : "bg-cloud-2 hover:bg-cloud",
                  )}
                >
                  <span className="text-xl">🤖</span>
                  <div>
                    <div className="font-body font-bold text-[13px] text-ink">{bot.name}</div>
                    <div className="font-body text-[11px] text-ink-3">{bot.desc}</div>
                  </div>
                  {botId === bot.id && (
                    <span className="ml-auto text-violet font-bold">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded-chunk border-[2px] border-coral bg-coral/10 px-3 py-2 font-body text-[12px] text-coral">{error}</p>
          )}

          <button
            onClick={handlePlay}
            disabled={loading}
            className={cx(
              "w-full rounded-chunk border-[3px] border-ink bg-violet py-3 font-display text-lg font-bold text-cloud shadow-pop transition-all",
              loading ? "opacity-60 cursor-not-allowed" : "hover:shadow-pop-press active:shadow-pop-press",
            )}
          >
            {loading ? "Creating…" : "Play!"}
          </button>
        </div>
      </div>
    </div>
  );
}
