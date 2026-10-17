"use client";
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import type React from "react";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";

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

  const [gameClass, setGameClass] = useState<GameClass>("open");
  const [tc, setTc]               = useState<TimeControl>("3+2");
  const [status, setStatus]       = useState<"idle" | "queued" | "matched" | "error">("idle");
  const [ticketId, setTicketId]   = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const serverUrl = API_BASE;
  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPolling(), []);

  const handleQueue = async () => {
    if (!session?.user?.id) { setError("Sign in with X to join matchmaking."); return; }
    setError(null); setStatus("queued");
    try {
      const res = await fetch(`${serverUrl}/v1/matchmaking/queue`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: session.user.id, handle: session.user.handle ?? session.user.name ?? "Player", avatarUrl: session.user.image ?? undefined, gameClass, timeControl: tc }),
      });
      const data = await res.json() as { ticketId: string };
      setTicketId(data.ticketId);
      pollRef.current = setInterval(async () => {
        const r = await fetch(`${serverUrl}/v1/matchmaking/queue/${data.ticketId}`);
        const d = await r.json() as { status: string };
        if (d.status === "matched") { stopPolling(); setStatus("matched"); router.push("/"); }
        else if (d.status === "no_match" || d.status === "expired") { stopPolling(); setStatus("idle"); setError("No match found. Try again or play a bot from Home."); }
      }, 2_000);
    } catch { setStatus("idle"); setError("Failed to join queue."); }
  };

  const handleCancel = async () => {
    stopPolling(); setStatus("idle");
    if (ticketId) { await fetch(`${serverUrl}/v1/matchmaking/queue/${ticketId}`, { method: "DELETE" }).catch(() => {}); setTicketId(null); }
  };

  const inputCls = "w-full rounded-2xl border-2 px-3 py-2 text-[13px] font-semibold outline-none transition-colors";
  const inputStyle = { borderColor: "rgb(var(--ink) / 0.18)", background: "rgb(var(--cloud-2))", color: "rgb(var(--ink))" };

  return (
    <div className="min-h-screen" style={{ background: "rgb(var(--sky))" }}>
      <header className="flex items-center justify-between px-4 py-3 border-b-2" style={{ background: "rgb(var(--cloud) / 0.85)", borderColor: "rgb(var(--ink) / 0.10)" }}>
        <Link href="/" className="font-display font-extrabold text-xl" style={{ color: "rgb(var(--ink))" }}>Final Move</Link>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: "rgb(var(--ink-2))" }}>Find a game</span>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-6 flex flex-col gap-4">
        {/* Class */}
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-extrabold uppercase tracking-widest font-display" style={{ color: "rgb(var(--ink-3))" }}>Game class</p>
          {CLASSES.map((c) => (
            <button key={c.id} onClick={() => setGameClass(c.id)}
              className="flex items-start gap-3 rounded-2xl border-2 px-3 py-3 text-left transition-all"
              style={{ borderColor: gameClass === c.id ? "rgb(var(--teal))" : "rgb(var(--ink) / 0.15)", background: gameClass === c.id ? "rgb(var(--teal-light))" : "rgb(var(--cloud))", boxShadow: gameClass === c.id ? "3px 3px 0 rgb(var(--teal-light))" : "none" }}
            >
              <div className="mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center flex-shrink-0" style={{ borderColor: gameClass === c.id ? "rgb(var(--teal))" : "rgb(var(--ink) / 0.3)" }}>
                {gameClass === c.id && <div className="h-2 w-2 rounded-full" style={{ background: "rgb(var(--teal))" }} />}
              </div>
              <div>
                <div className="text-sm font-extrabold font-display" style={{ color: "rgb(var(--ink))" }}>{c.label}</div>
                <div className="text-[11px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>{c.desc}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Time control */}
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-widest font-display mb-2" style={{ color: "rgb(var(--ink-3))" }}>Time control</p>
          <div className="grid grid-cols-3 gap-2">
            {TIME_CONTROLS.map((t) => (
              <button key={t} onClick={() => setTc(t)}
                className="rounded-2xl border-2 py-2.5 font-display font-extrabold text-sm transition-all"
                style={{ borderColor: tc === t ? "rgb(var(--ink))" : "rgb(var(--ink) / 0.15)", background: tc === t ? "rgb(var(--teal))" : "rgb(var(--cloud))", color: tc === t ? "#fff" : "rgb(var(--ink))", boxShadow: tc === t ? "3px 3px 0 rgb(var(--pop-shadow))" : "none" }}
              >{t}</button>
            ))}
          </div>
        </div>

        {error && <p className="rounded-2xl border-2 px-3 py-2.5 text-[12px] font-bold" style={{ borderColor: "rgb(var(--danger))", background: "rgb(var(--danger) / 0.08)", color: "rgb(var(--danger))" }}>{error}</p>}

        {status === "idle" && (
          <button onClick={() => { void handleQueue(); }} className="pop-btn w-full rounded-2xl py-4 font-display text-xl font-extrabold">
            Find a game
          </button>
        )}

        {status === "queued" && (
          <div className="sticker-card p-6 text-center flex flex-col gap-4 items-center">
            <div className="h-10 w-10 rounded-full border-[3px] border-t-transparent animate-spin" style={{ borderColor: `rgb(var(--teal)) rgb(var(--teal)) rgb(var(--teal)) transparent` }} />
            <p className="font-display font-extrabold" style={{ color: "rgb(var(--ink))" }}>Searching for an opponent…</p>
            <p className="text-[12px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>Rating window widens automatically. Up to 30 seconds.</p>
            <button onClick={() => { void handleCancel(); }} className="pop-btn-ghost pop-btn rounded-full px-4 py-1.5 text-sm font-bold">Cancel</button>
          </div>
        )}

        <ChallengeLink gameClass={gameClass} tc={tc} inputCls={inputCls} inputStyle={inputStyle} />
      </main>
    </div>
  );
}

function ChallengeLink({ gameClass, tc, inputCls, inputStyle }: { gameClass: GameClass; tc: TimeControl; inputCls: string; inputStyle: React.CSSProperties }): React.JSX.Element {
  const { data: session } = useSession();
  const [url, setUrl]     = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!session?.user?.id) return;
    const res = await fetch(`${API_BASE}/v1/challenges`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengerId: session.user.id, gameClass, timeControl: tc }) });
    const d = await res.json() as { url: string };
    setUrl(d.url);
  };
  const copy = () => { if (url) { navigator.clipboard.writeText(url).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2_000); } };

  return (
    <div className="sticker-card-sm p-5 flex flex-col gap-3">
      <p className="text-[11px] font-extrabold uppercase tracking-widest font-display" style={{ color: "rgb(var(--ink-3))" }}>Challenge a friend</p>
      <p className="text-[12px] font-medium" style={{ color: "rgb(var(--ink-2))" }}>Share a link — valid for 10 minutes. They click and you&apos;re matched instantly.</p>
      {!url ? (
        <button onClick={() => { void generate(); }} disabled={!session?.user?.id}
          className="pop-btn-ghost pop-btn w-full rounded-2xl py-2 text-sm font-bold disabled:opacity-50">
          {session?.user?.id ? "Generate link" : "Sign in to create a link"}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input readOnly value={url} className={`${inputCls} flex-1`} style={inputStyle} />
          <button onClick={copy} className="pop-btn rounded-2xl px-3 py-2 text-[12px] font-extrabold">
            {copied ? "✓" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
