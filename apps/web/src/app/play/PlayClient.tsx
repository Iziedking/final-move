"use client";
/**
 * Play a person: join the rated queue, or make a one-time challenge link for a
 * friend. Both need an X sign-in because each player moves from their own wallet.
 */
import { apiFetch, describeError } from "@/lib/session";
import Link from "next/link";
import type React from "react";
import { useState, useEffect, useRef } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";

type GameClass   = "open" | "human";
type TimeControl = "3+2" | "5+3" | "10+5";

const TIME_CONTROLS: { id: TimeControl; desc: string }[] = [
  { id: "3+2", desc: "Blitz" },
  { id: "5+3", desc: "Blitz" },
  { id: "10+5", desc: "Rapid" },
];
const CLASSES: { id: GameClass; label: string; desc: string }[] = [
  { id: "open",  label: "Open",  desc: "People, agents and engines" },
  { id: "human", label: "Human", desc: "People only, with fair-play review" },
];

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { id: T; title: string; sub: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-extrabold" style={{ color: "rgb(var(--ink-2))" }}>{label}</p>
      <div role="radiogroup" aria-label={label} className="grid gap-1 rounded-[22px] p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`, background: "rgb(var(--sky-2))", border: "2px solid rgb(var(--ink))" }}>
        {options.map((o) => {
          const on = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.id)}
              className="min-h-[48px] rounded-[18px] px-2 py-1.5 leading-tight"
              style={{ background: on ? "rgb(var(--cloud))" : "transparent", boxShadow: on ? "0 0 0 2px rgb(var(--ink))" : undefined, color: "rgb(var(--ink))" }}
            >
              <span className="block font-display text-[16px] font-extrabold">{o.title}</span>
              <span className="block text-[11px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>{o.sub}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-[var(--r)] px-3.5 py-2.5 text-[14px] font-bold"
      style={{ border: "2px solid rgb(var(--coral))", background: "rgb(var(--coral) / 0.1)", color: "rgb(var(--ink))" }}>
      {children}
    </p>
  );
}

export function PlayClient(): React.JSX.Element {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();

  const [gameClass, setGameClass] = useState<GameClass>("open");
  const [tc, setTc]               = useState<TimeControl>("5+3");
  const [status, setStatus]       = useState<"idle" | "queued" | "matched" | "error">("idle");
  const [ticketId, setTicketId]   = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [queuedAt, setQueuedAt]   = useState<number | null>(null);
  const [now, setNow]             = useState(() => Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPolling(), []);
  useEffect(() => {
    if (status !== "queued") return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [status]);

  const handleQueue = async () => {
    if (!session?.user?.id) { setError("Sign in with X to join matchmaking."); return; }
    setError(null); setStatus("queued"); setQueuedAt(Date.now()); setNow(Date.now());
    try {
      const res = await apiFetch("/v1/matchmaking/queue", {
        method: "POST",
        body: JSON.stringify({ handle: session.user.handle ?? session.user.name ?? "Player", avatarUrl: session.user.image ?? undefined, gameClass, timeControl: tc }),
      }, session.user.id);
      const data = await res.json() as { ticketId?: string; error?: string };
      if (!res.ok || !data.ticketId) { setStatus("idle"); setError(describeError(data.error)); return; }
      setTicketId(data.ticketId);
      pollRef.current = setInterval(async () => {
        const r = await apiFetch(`/v1/matchmaking/queue/${data.ticketId}`, {}, session.user.id);
        const d = await r.json() as { status: string; gameId?: string };
        if (d.status === "matched" && d.gameId) { stopPolling(); setStatus("matched"); router.push(`/game/${d.gameId}`); }
        else if (d.status === "no_match" || d.status === "expired") { stopPolling(); setStatus("idle"); setError("Nobody was free at your rating just now. Try again, or play a bot while you wait."); }
      }, 2_000);
    } catch { setStatus("idle"); setError("We could not join the queue. Check your connection and try again."); }
  };

  const handleCancel = async () => {
    stopPolling(); setStatus("idle");
    if (ticketId) { await apiFetch(`/v1/matchmaking/queue/${ticketId}`, { method: "DELETE" }, session?.user?.id ?? null).catch(() => {}); setTicketId(null); }
  };

  const signedIn = !!session?.user?.id;
  const elapsed = queuedAt ? Math.floor((now - queuedAt) / 1000) : 0;
  // Mirrors the server: the window starts at 4 rating points and widens by 2 each second.
  const windowPts = 4 + elapsed * 2;

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1440px] px-4 pt-8 sm:px-6 lg:px-10 lg:pt-12">
        <h1 className="font-display font-extrabold" style={{ fontSize: "clamp(38px, 5.4vw, 64px)", lineHeight: 1, color: "rgb(var(--ink))" }}>
          Play a person
        </h1>
        <p className="mt-3 max-w-[560px] text-[17px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
          Get matched by rating, or send a friend a link. Every game is rated, and every move is a transaction from your own wallet on Arc.
        </p>

        {sessionStatus !== "loading" && !signedIn ? (
          <div className="sticker-card-lg mt-8 flex max-w-[640px] flex-col gap-4 p-6" style={{ background: "rgb(var(--violet-light))" }}>
            <h2 className="font-display text-[26px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>Sign in with X to play people</h2>
            <p className="text-[15px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
              Rated games need a stable identity and a wallet of your own, so we set one up when you sign in. It takes a few seconds and there is nothing to install.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={() => signIn("twitter")} className="pop-btn min-h-[52px] px-6 text-[16px]">Sign in with X</button>
              <Link href="/" className="pop-btn pop-btn-ghost min-h-[52px] px-6 text-[16px]">Play a bot instead</Link>
            </div>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Find an opponent */}
            <section className="sticker-card flex flex-col gap-5 p-6" aria-labelledby="find">
              <h2 id="find" className="font-display text-[26px] font-extrabold leading-none" style={{ color: "rgb(var(--ink))" }}>Find an opponent</h2>
              <Segmented label="Class" value={gameClass} onChange={setGameClass} options={CLASSES.map((c) => ({ id: c.id, title: c.label, sub: c.desc }))} />
              <Segmented label="Time control" value={tc} onChange={setTc} options={TIME_CONTROLS.map((t) => ({ id: t.id, title: t.id.replace("+", " + "), sub: t.desc }))} />

              {error && <ErrorNote>{error}</ErrorNote>}

              <div aria-live="polite">
                {status === "queued" || status === "matched" ? (
                  <div className="flex flex-col items-center gap-3 rounded-[var(--r-lg)] p-5 text-center" style={{ background: "rgb(var(--cloud-2))", border: "2px solid rgb(var(--ink))" }}>
                    <div className="flex gap-2" aria-hidden>
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="h-3.5 w-3.5 rounded-full" style={{ background: ["rgb(var(--violet))", "rgb(var(--mint))", "rgb(var(--amber))"][i], border: "2px solid rgb(var(--ink))", animation: `pulse 1.2s ${i * 0.2}s infinite` }} />
                      ))}
                    </div>
                    <p className="font-display text-[22px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>
                      {status === "matched" ? "Opponent found. Setting up the board…" : "Looking for an opponent"}
                    </p>
                    {status === "queued" && (
                      <>
                        <p className="font-display text-[34px] font-extrabold leading-none tabular-nums" style={{ color: "rgb(var(--violet))" }}>
                          0:{String(Math.min(elapsed, 59)).padStart(2, "0")}
                        </p>
                        <p className="text-[13px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
                          Matching within ±{windowPts} rating points. The range widens every second, for up to 30 seconds.
                        </p>
                        <button type="button" onClick={() => { void handleCancel(); }} className="pop-btn pop-btn-ghost min-h-[44px] px-6 text-[15px]">Cancel</button>
                      </>
                    )}
                  </div>
                ) : (
                  <button type="button" onClick={() => { void handleQueue(); }} disabled={!signedIn} className="pop-btn min-h-[56px] w-full font-display text-[20px]">
                    Find a game
                  </button>
                )}
              </div>
            </section>

            <ChallengeLink gameClass={gameClass} tc={tc} />
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function ChallengeLink({ gameClass, tc }: { gameClass: GameClass; tc: TimeControl }): React.JSX.Element {
  const { data: session } = useSession();
  const router = useRouter();
  const [url, setUrl]     = useState<string | null>(null);
  const [code, setCode]   = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"); }, []);

  const generate = async () => {
    if (!session?.user?.id) return;
    setLinkError(null); setBusy(true);
    try {
      const res = await apiFetch("/v1/challenges", { method: "POST", body: JSON.stringify({ gameClass, timeControl: tc }) }, session.user.id);
      const d = await res.json() as { url?: string; code?: string; error?: string };
      if (!res.ok || !d.url || !d.code) { setLinkError(describeError(d.error)); return; }
      setUrl(d.url); setCode(d.code);
    } catch {
      setLinkError("We could not make a link. Check your connection and try again.");
    } finally { setBusy(false); }
  };

  // Once the friend accepts, take the challenger to the game.
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(async () => {
      const r = await apiFetch(`/v1/challenges/${code}/result`, {}, session?.user?.id ?? null).catch(() => null);
      const d = r?.ok ? await r.json() as { status: string; gameId?: string } : null;
      if (d?.status === "accepted" && d.gameId) { clearInterval(timer); router.push(`/game/${d.gameId}`); }
    }, 2_000);
    const stop = setTimeout(() => clearInterval(timer), 10 * 60_000);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [code, router, session?.user?.id]);

  const copy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2_000); }).catch(() => {});
  };
  const share = () => {
    if (!url) return;
    navigator.share({ title: "Final Move", text: `Play me at chess on Final Move (${tc.replace("+", " + ")}).`, url }).catch(() => {});
  };

  return (
    <section className="sticker-card flex flex-col gap-4 p-6" aria-labelledby="challenge" style={{ background: "rgb(var(--cloud))" }}>
      <h2 id="challenge" className="font-display text-[26px] font-extrabold leading-none" style={{ color: "rgb(var(--ink))" }}>Challenge a friend</h2>
      <p className="text-[15px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
        Make a link for a {tc.replace("+", " + ")} {gameClass === "open" ? "Open" : "Human"} game. It works once and lasts 10 minutes. When your friend opens it, you both land in the game.
      </p>
      {!url ? (
        <button type="button" onClick={() => { void generate(); }} disabled={!session?.user?.id || busy} className="pop-btn pop-btn-amber min-h-[52px] w-full text-[16px]">
          {busy ? "Making your link…" : "Make a challenge link"}
        </button>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-[var(--r)] p-1.5 pl-3" style={{ background: "rgb(var(--cloud-2))", border: "2px solid rgb(var(--ink))" }}>
            <label htmlFor="challenge-url" className="sr-only">Challenge link</label>
            <input id="challenge-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none" style={{ color: "rgb(var(--ink))" }} />
            <button type="button" onClick={copy} className="pop-btn min-h-[40px] shrink-0 px-4 text-[14px]" style={copied ? { background: "rgb(var(--mint))", color: "rgb(var(--candy-ink))" } : undefined}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {canShare && (
            <button type="button" onClick={share} className="pop-btn pop-btn-ghost min-h-[48px] w-full text-[15px]">Share link</button>
          )}
          <p className="flex items-center gap-2 text-[14px] font-bold" style={{ color: "rgb(var(--ink-2))" }} aria-live="polite">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: "rgb(var(--mint))", border: "1.5px solid rgb(var(--ink))" }} />
            Waiting for your friend. Keep this page open and you will join automatically.
          </p>
        </>
      )}
      {linkError && <ErrorNote>{linkError}</ErrorNote>}
    </section>
  );
}
