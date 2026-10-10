"use client";
import type React from "react";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { cx } from "@/lib/utils";

type GameClass   = "open" | "human";
type TimeControl = "3+2" | "5+3" | "10+5";

const TIME_CONTROLS: TimeControl[] = ["3+2", "5+3", "10+5"];
const CLASSES: { id: GameClass; label: string; desc: string }[] = [
  { id: "open",  label: "Open",  desc: "Humans, agents, engines allowed" },
  { id: "human", label: "Human", desc: "Humans only, fair-play monitored" },
];

export function PlayClient(): React.JSX.Element {
  const { data: session } = useSession();
  const router = useRouter();

  const [gameClass, setGameClass]   = useState<GameClass>("open");
  const [tc, setTc]                 = useState<TimeControl>("3+2");
  const [status, setStatus]         = useState<"idle" | "queued" | "matched" | "error">("idle");
  const [ticketId, setTicketId]     = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const handleQueue = async () => {
    if (!session?.user?.id) {
      setError("Sign in with X to join matchmaking.");
      return;
    }
    setError(null);
    setStatus("queued");

    try {
      const res = await fetch(`${serverUrl}/v1/matchmaking/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId:    session.user.id,
          handle:      session.user.handle ?? session.user.name ?? "Player",
          avatarUrl:   session.user.image ?? undefined,
          gameClass,
          timeControl: tc,
        }),
      });
      const data = await res.json() as { ticketId: string };
      setTicketId(data.ticketId);

      // Poll for match
      pollRef.current = setInterval(async () => {
        const r = await fetch(`${serverUrl}/v1/matchmaking/queue/${data.ticketId}`);
        const d = await r.json() as { status: string; opponentId?: string };
        if (d.status === "matched") {
          stopPolling();
          setStatus("matched");
          // Create game between the two players
          // For now navigate to home with a success notice; full matchmaking creates game server-side
          router.push("/");
        } else if (d.status === "no_match" || d.status === "expired") {
          stopPolling();
          setStatus("idle");
          setError("No match found. Try again or play a bot from Home.");
        }
      }, 2_000);
    } catch {
      setStatus("idle");
      setError("Failed to join queue.");
    }
  };

  const handleCancel = async () => {
    stopPolling();
    setStatus("idle");
    if (ticketId) {
      await fetch(`${serverUrl}/v1/matchmaking/queue/${ticketId}`, { method: "DELETE" }).catch(() => {});
      setTicketId(null);
    }
  };

  return (
    <div className="min-h-screen bg-sky">
      <header className="flex items-center justify-between px-4 py-3 border-b-[3px] border-ink bg-cloud shadow-pop-press">
        <a href="/" className="font-display font-bold text-xl text-ink">Final Move</a>
        <span className="font-body text-sm text-ink-2">Find a game</span>
      </header>

      <main className="max-w-md mx-auto px-4 py-6 flex flex-col gap-4">

        {/* Class */}
        <div className="flex flex-col gap-2">
          <p className="font-body font-bold text-[13px] text-ink">Game class</p>
          {CLASSES.map((c) => (
            <button
              key={c.id}
              onClick={() => setGameClass(c.id)}
              className={cx(
                "flex items-start gap-3 rounded-chunk border-[2px] border-ink px-3 py-2.5 text-left transition-all shadow-pop-press",
                gameClass === c.id ? "bg-violet/15 border-violet" : "bg-cloud hover:bg-cloud-2",
              )}
            >
              <div className="mt-0.5 h-4 w-4 rounded-full border-[2px] border-ink flex items-center justify-center flex-shrink-0">
                {gameClass === c.id && <div className="h-2 w-2 rounded-full bg-violet" />}
              </div>
              <div>
                <div className="font-body font-bold text-sm text-ink">{c.label}</div>
                <div className="font-body text-[11px] text-ink-3">{c.desc}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Time control */}
        <div>
          <p className="font-body font-bold text-[13px] text-ink mb-2">Time control</p>
          <div className="grid grid-cols-3 gap-2">
            {TIME_CONTROLS.map((t) => (
              <button
                key={t}
                onClick={() => setTc(t)}
                className={cx(
                  "rounded-chunk border-[2px] border-ink py-2.5 font-display font-bold text-sm shadow-pop-press transition-all",
                  tc === t ? "bg-violet text-cloud" : "bg-cloud text-ink hover:bg-cloud-2",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="rounded-chunk border-[2px] border-coral bg-coral/10 px-3 py-2 font-body text-[12px] text-coral">
            {error}
          </p>
        )}

        {status === "idle" && (
          <button
            onClick={handleQueue}
            className="w-full rounded-chunk border-[3px] border-ink bg-violet py-4 font-display text-xl font-bold text-cloud shadow-pop hover:shadow-pop-press active:shadow-pop-press transition-all"
          >
            Find a game
          </button>
        )}

        {status === "queued" && (
          <div className="rounded-chunk border-[3px] border-ink bg-cloud p-5 shadow-pop text-center flex flex-col gap-4 items-center">
            <div className="h-10 w-10 rounded-full border-[3px] border-violet border-t-transparent animate-spin" />
            <p className="font-display font-bold text-ink">Searching for an opponent…</p>
            <p className="font-body text-[12px] text-ink-3">
              Rating window widens automatically. Up to 30 seconds.
            </p>
            <button
              onClick={handleCancel}
              className="rounded-pill border-[2px] border-ink bg-cloud-2 px-4 py-1.5 font-body font-bold text-sm text-ink shadow-pop-press"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Challenge link */}
        <ChallengeLink gameClass={gameClass} tc={tc} />

      </main>
    </div>
  );
}

function ChallengeLink({ gameClass, tc }: { gameClass: GameClass; tc: TimeControl }): React.JSX.Element {
  const { data: session } = useSession();
  const [url, setUrl]   = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

  const generate = async () => {
    if (!session?.user?.id) return;
    const res = await fetch(`${serverUrl}/v1/challenges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengerId: session.user.id, gameClass, timeControl: tc }),
    });
    const d = await res.json() as { url: string };
    setUrl(d.url);
  };

  const copy = () => {
    if (url) {
      navigator.clipboard.writeText(url).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    }
  };

  return (
    <div className="rounded-chunk border-[3px] border-ink bg-cloud p-4 shadow-pop flex flex-col gap-3">
      <p className="font-body font-bold text-[13px] text-ink">Challenge a friend</p>
      <p className="font-body text-[12px] text-ink-3">
        Share a link — valid for 10 minutes. They click and you&apos;re matched instantly.
      </p>
      {!url ? (
        <button
          onClick={generate}
          disabled={!session?.user?.id}
          className="rounded-chunk border-[2px] border-ink bg-cyan py-2 font-body font-bold text-sm text-ink shadow-pop-press hover:bg-cyan/80 transition-colors disabled:opacity-50"
        >
          {session?.user?.id ? "Generate link" : "Sign in to create a link"}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={url}
            className="flex-1 rounded-chunk border-[2px] border-ink bg-cloud-2 px-3 py-1.5 font-mono text-[11px] text-ink-2 outline-none"
          />
          <button
            onClick={copy}
            className="rounded-chunk border-[2px] border-ink bg-violet px-3 py-1.5 font-body font-bold text-[12px] text-cloud shadow-pop-press"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
