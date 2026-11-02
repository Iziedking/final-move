"use client";
/**
 * The game screen. The board is the hero; clocks and players frame it, and a
 * side panel holds the move list and the chain record. Every state the player
 * can be in (first move, opponent thinking, review, offers, the end) is said in
 * plain words in one status line, so nothing needs a manual.
 */
import Link from "next/link";
import type React from "react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  sanLine, parseFEN, legalMoves as engineLegalMoves, moveToUci, moveToSan, capturedValue, inCheck,
} from "@final-move/chess";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useGameWs } from "@/lib/useGameWs";
import { PlayBoard } from "@/components/PlayBoard";
import { PlayerBar } from "@/components/PlayerBar";
import { Clock } from "@/components/Clock";
import { ThemeToggle } from "@/components/ThemeToggle";
import { explorerTx } from "@/lib/utils";
import { apiFetch, getPlayer, describeError, type Player } from "@/lib/session";
import { sfx, isMuted, setMuted, onMutedChange, preloadSounds } from "@/lib/sound";
import type { PlayerInfo, ChainRailEntry, WsGameState } from "@/lib/types";

interface Props {
  gameId: string;
  playerId?: string;
  myColor?: "w" | "b";
}

type Side = "w" | "b";

const REASON: Record<string, string> = {
  checkmate: "by checkmate",
  resignation: "by resignation",
  timeout: "on time",
  abandon: "by abandonment",
  stalemate: "by stalemate",
  repetition: "by repetition",
  "fifty-move": "by the fifty-move rule",
  "insufficient-material": "by insufficient material",
  agreement: "by agreement",
  aborted: "Nobody moved in time, so the game was called off. Ratings are unchanged.",
};

// ── Small pieces ──────────────────────────────────────────────────────────────

function IconButton({ label, onClick, pressed, children }: {
  label: string; onClick: () => void; pressed?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-full transition-transform hover:-translate-x-px hover:-translate-y-px active:translate-x-px active:translate-y-px"
      style={{
        background: pressed ? "rgb(var(--violet-light))" : "rgb(var(--cloud))",
        color: "rgb(var(--ink))",
        border: "2px solid rgb(var(--ink))",
        boxShadow: "2px 2px 0 rgb(var(--pop-shadow))",
      }}
    >
      {children}
    </button>
  );
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8h2.8L10 5v10l-3.7-3H3.5z" fill="currentColor" />
      {muted ? <path d="M13 8l4 4M17 8l-4 4" /> : <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.2 5.5a6.5 6.5 0 0 1 0 9" />}
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v12M6 15l-3-3M6 15l3-3M14 17V5M14 5l-3 3M14 5l3 3" />
    </svg>
  );
}

function Confetti() {
  const colours = ["--violet", "--amber", "--mint", "--coral", "--cyan"];
  return (
    <div className="confetti pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden>
      {Array.from({ length: 44 }).map((_, i) => (
        <span
          key={i}
          className="absolute top-0"
          style={{
            left: `${(i * 37) % 100}%`,
            width: `${7 + (i % 4) * 2}px`,
            height: `${9 + (i % 5) * 2}px`,
            borderRadius: i % 3 === 0 ? "999px" : "3px",
            border: "1.5px solid rgb(var(--ink))",
            background: `rgb(var(${colours[i % colours.length]}))`,
            animation: `confetti-fall ${1.4 + (i % 4) * 0.35}s ${(i % 9) * 0.09}s cubic-bezier(.25,.46,.45,.94) forwards`,
          }}
        />
      ))}
    </div>
  );
}

// ── Move list ─────────────────────────────────────────────────────────────────

function MoveList({ sans, livePly, reviewPly, onPick }: {
  sans: string[]; livePly: number; reviewPly: number | null; onPick: (ply: number) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const current = reviewPly ?? livePly;

  useEffect(() => {
    if (reviewPly !== null) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [sans.length, reviewPly]);

  if (sans.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
        Moves appear here as they are played.
      </p>
    );
  }

  const rows: Array<[number, string, string | undefined]> = [];
  for (let i = 0; i < sans.length; i += 2) rows.push([i / 2 + 1, sans[i]!, sans[i + 1]]);

  const cell = (ply: number, san: string | undefined) => {
    if (!san) return <span />;
    const on = ply === current;
    return (
      <button
        type="button"
        onClick={() => onPick(ply)}
        aria-current={on ? "step" : undefined}
        className="rounded-lg px-2 py-1 text-left font-display text-[15px] font-bold leading-tight transition-colors"
        style={{
          background: on ? "rgb(var(--violet))" : "transparent",
          color: on ? "#fff" : "rgb(var(--ink))",
        }}
      >
        {san}
      </button>
    );
  };

  return (
    <ol ref={listRef} className="grid max-h-[280px] grid-cols-[2.25rem_1fr_1fr] gap-x-1 gap-y-0.5 overflow-y-auto pr-1 lg:max-h-[360px]" aria-label="Moves">
      {rows.map(([n, w, b]) => (
        <li key={n} className="contents">
          <span className="self-center text-right text-[12px] font-bold tabular-nums" style={{ color: "rgb(var(--ink-3))" }}>{n}.</span>
          {cell(n * 2 - 1, w)}
          {cell(n * 2, b)}
        </li>
      ))}
    </ol>
  );
}

// ── Chain record ──────────────────────────────────────────────────────────────

const STATE: Record<ChainRailEntry["state"], { dot: string; label: string }> = {
  queued:   { dot: "var(--ink-3)", label: "Queued" },
  sent:     { dot: "var(--cyan)",  label: "Sent" },
  complete: { dot: "var(--cyan)",  label: "Confirming" },
  final:    { dot: "var(--mint)",  label: "Final" },
};

function ChainRecord({ entries, sans, plyCount }: { entries: ChainRailEntry[]; sans: string[]; plyCount: number }) {
  const rows = [...entries].sort((a, b) => b.ply - a.ply);
  const finalCount = entries.filter((e) => e.state === "final").length;
  const pct = plyCount === 0 ? 0 : Math.round((finalCount / plyCount) * 100);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="font-display text-[15px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>
          {finalCount} of {plyCount} {plyCount === 1 ? "move" : "moves"} final on Arc
        </p>
        <div className="mt-1.5 h-3 overflow-hidden rounded-full" style={{ border: "2px solid rgb(var(--ink))", background: "rgb(var(--cloud-2))" }}>
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: "rgb(var(--mint))" }} />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
          Each move becomes a transaction from the mover&apos;s own wallet.
        </p>
      ) : (
        <ul className="flex max-h-[280px] flex-col gap-1 overflow-y-auto pr-1 lg:max-h-[320px]" aria-label="Moves on Arc">
          {rows.map((e) => {
            const st = STATE[e.state];
            return (
              <li key={e.ply} className="flex items-center gap-2 rounded-xl px-2 py-1.5" style={{ background: "rgb(var(--cloud-2))" }}>
                <span className="w-6 text-right text-[12px] font-bold tabular-nums" style={{ color: "rgb(var(--ink-3))" }}>{e.ply}</span>
                <span className="min-w-0 flex-1 truncate font-display text-[14px] font-bold" style={{ color: "rgb(var(--ink))" }}>
                  {sans[e.ply - 1] ?? e.san}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold" style={{ color: "rgb(var(--ink-2))" }}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: `rgb(${st.dot})`, border: "1.5px solid rgb(var(--ink))" }} />
                  {st.label}
                  {e.state === "final" && (e.finalMs ?? 0) > 0 && (
                    <span className="tabular-nums" style={{ color: "rgb(var(--ink-3))" }}>{((e.finalMs ?? 0) / 1000).toFixed(1)} s</span>
                  )}
                </span>
                {e.txHash ? (
                  <a
                    href={explorerTx(e.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Move ${e.ply} on the Arc explorer`}
                    className="grid h-7 w-7 place-items-center rounded-lg font-bold transition-colors hover:bg-[rgb(var(--violet-light))]"
                    style={{ color: "rgb(var(--violet))" }}
                  >
                    ↗
                  </a>
                ) : <span className="h-7 w-7" />}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[12px] font-semibold leading-snug" style={{ color: "rgb(var(--ink-3))" }}>
        The board never waits for the chain, and chain time never comes off your clock.
      </p>
    </div>
  );
}

// ── End of game ───────────────────────────────────────────────────────────────

function EndCard({
  gs, myColor, delta, finalCount, lastHash, rematch, onRematch, onHide,
}: {
  gs: WsGameState;
  myColor: Side | null;
  delta: number | null;
  finalCount: number;
  lastHash?: string;
  rematch: { state: "idle" | "sending" | "offered" | "incoming" | "error"; error?: string; canRematch: boolean };
  onRematch: () => void;
  onHide: () => void;
}) {
  const aborted = gs.status === "aborted" || gs.result === "aborted";
  const drew = gs.result === "draw";
  const winner: Side | null = gs.result === "white" ? "w" : gs.result === "black" ? "b" : null;
  const won = !!myColor && winner === myColor;
  const lost = !!myColor && !!winner && winner !== myColor;
  const winnerName = winner === "w" ? gs.white.handle : winner === "b" ? gs.black.handle : "";

  const title = aborted ? "Game called off" : drew ? "Draw" : won ? "You won" : lost ? "You lost" : `${winnerName} wins`;
  const stamp = aborted ? "rgb(var(--cloud-2))" : drew ? "rgb(var(--cyan))" : won ? "rgb(var(--mint))" : lost ? "rgb(var(--coral))" : "rgb(var(--amber))";
  const stampInk = lost ? "#fff" : "rgb(var(--candy-ink))";
  const reason = gs.reason ? REASON[gs.reason] ?? gs.reason.replace(/-/g, " ") : "";

  return (
    <div
      className="absolute inset-0 z-20 grid place-items-center p-3"
      style={{ background: "rgb(var(--scrim) / 0.42)", borderRadius: "var(--r-lg)", animation: "fade-in 200ms ease both" }}
      role="dialog"
      aria-modal="false"
      aria-labelledby="end-title"
    >
      <div className="sticker-card-lg w-full max-w-[360px] p-5 text-center" style={{ animation: "pop-in 260ms var(--spring) both" }}>
        <div
          id="end-title"
          className="mx-auto inline-block px-5 py-1.5 font-display text-[30px] font-extrabold leading-none"
          style={{
            background: stamp,
            color: stampInk,
            border: "var(--line) solid rgb(var(--ink))",
            borderRadius: "var(--r)",
            boxShadow: "4px 4px 0 rgb(var(--pop-shadow))",
            transform: "rotate(-3deg)",
          }}
        >
          {title}
        </div>

        {reason && (
          <p className="mt-3 text-[15px] font-bold" style={{ color: "rgb(var(--ink-2))" }}>
            {aborted ? reason : reason.charAt(0).toUpperCase() + reason.slice(1)}
          </p>
        )}

        {!aborted && delta !== null && (
          <p className="mt-2 inline-flex items-center gap-2 text-sm font-bold" style={{ color: "rgb(var(--ink-2))" }}>
            Rating
            <span
              className="chip tabular-nums"
              style={{ background: delta >= 0 ? "rgb(var(--mint))" : "rgb(var(--coral))", color: delta >= 0 ? "rgb(var(--candy-ink))" : "#fff" }}
            >
              {delta >= 0 ? "+" : ""}{delta.toFixed(1)}
            </span>
          </p>
        )}

        {gs.plyCount > 0 && (
          <p className="mt-3 text-[14px] font-semibold leading-snug" style={{ color: "rgb(var(--ink-2))" }}>
            {finalCount === gs.plyCount
              ? <>All <strong style={{ color: "rgb(var(--ink))" }}>{gs.plyCount}</strong> moves are final on Arc.</>
              : <><strong style={{ color: "rgb(var(--ink))" }}>{finalCount} of {gs.plyCount}</strong> moves final on Arc so far.</>}
            {lastHash && (
              <> <a href={explorerTx(lastHash)} target="_blank" rel="noopener noreferrer" className="font-extrabold underline decoration-2 underline-offset-2" style={{ color: "rgb(var(--violet))" }}>Verify it</a></>
            )}
          </p>
        )}

        {rematch.state === "incoming" && (
          <p className="mt-3 text-sm font-extrabold" style={{ color: "rgb(var(--violet))" }}>Your opponent wants a rematch.</p>
        )}
        {rematch.state === "error" && (
          <p className="mt-3 text-sm font-bold" style={{ color: "rgb(var(--coral))" }} role="alert">{rematch.error}</p>
        )}

        <div className="mt-4 flex flex-col gap-2.5">
          {rematch.canRematch && (
            <button
              type="button"
              onClick={onRematch}
              disabled={rematch.state === "sending" || rematch.state === "offered"}
              className="pop-btn w-full px-4 text-[15px]"
            >
              {rematch.state === "sending" ? "Setting up…"
                : rematch.state === "offered" ? "Rematch offered, waiting…"
                : rematch.state === "incoming" ? "Accept rematch"
                : "Rematch"}
            </button>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <Link href="/" className="pop-btn pop-btn-ghost px-3 text-[14px]">New game</Link>
            <Link href={`/g/${gs.gameId}`} className="pop-btn pop-btn-ghost px-3 text-[14px]">Replay</Link>
          </div>
          <button type="button" onClick={onHide} className="mt-1 text-[13px] font-extrabold underline decoration-2 underline-offset-2" style={{ color: "rgb(var(--ink-2))" }}>
            See the final position
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Typed moves ───────────────────────────────────────────────────────────────

const strip = (s: string) => s.replace(/[+#!?]/g, "").replace(/0/g, "O").trim();

/** Resolve typed SAN ("Nf3", "exd5", "O-O") or UCI ("g1f3") to a legal UCI move. */
function resolveTyped(fen: string, text: string): string | null {
  const want = strip(text);
  if (!want) return null;
  const pos = parseFEN(fen);
  for (const m of engineLegalMoves(pos)) {
    const uci = moveToUci(m);
    if (uci === want.toLowerCase()) return uci;
    if (strip(moveToSan(pos, m)) === want) return uci;
  }
  return null;
}

function MoveInput({ fen, enabled, onMove }: { fen: string; enabled: boolean; onMove: (uci: string) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const uci = resolveTyped(fen, text);
        if (!uci) { setError(text.trim() ? `${text.trim()} is not a legal move here.` : ""); return; }
        setError(""); setText(""); onMove(uci);
      }}
    >
      <label htmlFor="move-input" className="sr-only">Type a move</label>
      <div className="flex gap-2">
        <input
          id="move-input"
          value={text}
          onChange={(e) => { setText(e.target.value); setError(""); }}
          disabled={!enabled}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={enabled ? "Type a move: e4, Nf3, O-O" : "Type a move on your turn"}
          className="min-h-[44px] min-w-0 flex-1 rounded-[var(--r)] px-3 font-display text-[15px] font-bold outline-none disabled:opacity-60"
          style={{ background: "rgb(var(--cloud))", color: "rgb(var(--ink))", border: "2px solid rgb(var(--ink))" }}
        />
        <button type="submit" disabled={!enabled || !text.trim()} className="pop-btn pop-btn-ghost px-4 text-[14px]">Play</button>
      </div>
      {error && <p className="text-[13px] font-bold" style={{ color: "rgb(var(--coral))" }} role="alert">{error}</p>}
    </form>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function GameClient({ gameId, playerId: injectedPlayerId, myColor: injectedColor }: Props): React.JSX.Element {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const signedInId: string | null = session?.user?.id ?? null;

  // The API issues the identity: a user token when signed in, a guest token otherwise.
  const [player, setPlayer] = useState<Player | null>(null);
  useEffect(() => {
    if (sessionStatus === "loading") return;
    getPlayer(signedInId).then(setPlayer).catch(() => setPlayer(null));
  }, [sessionStatus, signedInId]);
  const playerId = player?.playerId ?? injectedPlayerId ?? "";

  const { connected, gameState, chainRail, sendMove, drawOffer, rematchOfferedBy, ratingDelta, rematchGameId, authError } =
    useGameWs(gameId, player?.token ?? null);

  // An expired or rejected token: fetch a fresh one and the socket rejoins with it.
  useEffect(() => {
    if (authError) getPlayer(signedInId, true).then(setPlayer).catch(() => {});
  }, [authError, signedInId]);

  const [manualFlip, setManualFlip] = useState(false);
  const [tab, setTab] = useState<"moves" | "chain">("moves");
  const [reviewPly, setReviewPly] = useState<number | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [drawSentAt, setDrawSentAt] = useState<number | null>(null);
  const [declinedDrawAt, setDeclinedDrawAt] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [rematchState, setRematchState] = useState<"idle" | "sending" | "offered" | "error">("idle");
  const [rematchError, setRematchError] = useState("");
  const [endHidden, setEndHidden] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { setMutedState(isMuted()); return onMutedChange(setMutedState); }, []);
  useEffect(() => { preloadSounds(); }, []);

  // Offers expire on the server after 30 s; a slow tick is enough to retire them here.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 2_000); return () => clearInterval(t); }, []);

  const moves = gameState?.moves;
  const line = useMemo(() => sanLine(moves ?? []), [moves]);
  const livePly = line.san.length;

  // Sounds follow the record: a start chime when you join a fresh game, one sound per ply
  // read from its SAN, and a closing sound that depends on how the game went for you.
  const heard = useRef<{ ply: number; ended: boolean } | null>(null);
  const status = gameState?.status;
  const result = gameState?.result;
  useEffect(() => {
    if (!status) return;
    const ended = status === "ended" || status === "aborted";
    const prev = heard.current;
    heard.current = { ply: livePly, ended };
    const me = gameState ? (gameState.white.id === playerId ? "w" : gameState.black.id === playerId ? "b" : null) : null;
    if (!prev) { // first state after joining: no catch-up noise
      if (me && livePly === 0 && !ended) sfx.start();
      return;
    }
    if (livePly > prev.ply) {
      const mover = livePly % 2 === 1 ? "w" : "b";
      sfx.move(line.san[livePly - 1] ?? "", mover === me);
    }
    if (ended && !prev.ended) {
      const won = (result === "white" && me === "w") || (result === "black" && me === "b");
      const lost = (result === "white" && me === "b") || (result === "black" && me === "w");
      if (won) sfx.win(); else if (lost) sfx.lose(); else sfx.draw();
    }
  }, [livePly, status, result, line, gameState, playerId]);

  // A draw or rematch offer from the other side should be heard, since it expires.
  useEffect(() => {
    if (drawOffer && drawOffer.by !== playerId) sfx.notify();
  }, [drawOffer, playerId]);
  useEffect(() => {
    if (rematchOfferedBy && rematchOfferedBy !== playerId) sfx.notify();
  }, [rematchOfferedBy, playerId]);

  // Leave review mode when a new move lands only if the reviewer was on the live ply.
  useEffect(() => { setReviewPly((r) => (r !== null && r >= livePly ? null : r)); }, [livePly]);

  const handleRematch = useCallback(async () => {
    setRematchState("sending");
    const r = await apiFetch(`/v1/games/${gameId}/rematch`, { method: "POST" }, signedInId).catch(() => null);
    const body = (await r?.json().catch(() => null)) as { status?: string; error?: string; newGameId?: string } | null;
    if (r?.ok && body?.newGameId) { router.push(`/game/${body.newGameId}`); return; }
    if (r?.ok) { setRematchState("offered"); return; }
    setRematchError(body?.error === "rematch_taken" ? "A rematch already started from this game." : describeError(body?.error));
    setRematchState("error");
  }, [gameId, signedInId, router]);

  useEffect(() => { if (rematchGameId) router.push(`/game/${rematchGameId}`); }, [rematchGameId, router]);

  const post = useCallback(async (path: string) => {
    setActionError("");
    const r = await apiFetch(`/v1/games/${gameId}/${path}`, { method: "POST" }, signedInId).catch(() => null);
    if (!r?.ok) {
      const body = (await r?.json().catch(() => null)) as { error?: string } | null;
      setActionError(describeError(body?.error));
    }
    return !!r?.ok;
  }, [gameId, signedInId]);

  // Arrow keys step through the game; Escape returns to the live position.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (livePly === 0) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); setReviewPly((r) => Math.max(0, (r ?? livePly) - 1)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setReviewPly((r) => (r === null || r + 1 >= livePly ? null : r + 1)); }
      else if (e.key === "Escape") setReviewPly(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [livePly]);

  // ── Before the first state arrives ─────────────────────────────────────────
  if (!gameState) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4" style={{ background: "rgb(var(--sky))" }}>
        <div className="sticker-card px-8 py-6 text-center" style={{ animation: "pop-in 220ms var(--spring) both" }}>
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-[3px]" style={{ borderColor: "rgb(var(--violet))", borderTopColor: "transparent" }} />
          <p className="font-display text-lg font-extrabold" style={{ color: "rgb(var(--ink))" }}>
            {connected ? "Setting up the board…" : "Connecting to the game…"}
          </p>
          <p className="mt-1 text-[13px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
            If this takes long, check your connection. <Link href="/" className="underline">Back home</Link>
          </p>
        </div>
      </div>
    );
  }

  const gs = gameState;
  const myColor: Side | null = injectedColor ?? (gs.white.id === playerId ? "w" : gs.black.id === playerId ? "b" : null);
  const ended = gs.status === "ended" || gs.status === "aborted";
  const playing = gs.status === "live" || gs.status === "waiting";
  const reviewing = reviewPly !== null;
  const iAmOnMove = !!myColor && myColor === gs.turn && playing;
  const opponent = myColor === "w" ? gs.black : myColor === "b" ? gs.white : null;
  const vsBot = opponent?.kind === "bot";

  const displayFen = reviewing ? line.fens[reviewPly] ?? gs.fen : gs.fen;
  const shownPly = reviewing ? reviewPly : livePly;
  const lastUci = shownPly > 0 ? gs.moves[shownPly - 1] : undefined;
  const railByPly = new Map(chainRail.map((e) => [e.ply, e]));
  const lastMoveState = shownPly > 0 ? railByPly.get(shownPly)?.state : undefined;
  const finalCount = chainRail.filter((e) => e.state === "final").length;
  const lastHash = [...chainRail].sort((a, b) => b.ply - a.ply).find((e) => e.state === "final" && e.txHash)?.txHash;

  const pos = parseFEN(displayFen);
  const cap = capturedValue(pos);
  const legal = iAmOnMove && !reviewing ? engineLegalMoves(parseFEN(gs.fen)).map(moveToUci) : [];

  // Orientation: my side at the bottom; spectators see white at the bottom. Flip inverts.
  const bottomIsWhite = (myColor ?? "w") === "w" ? !manualFlip : manualFlip;
  const top: PlayerInfo = bottomIsWhite ? gs.black : gs.white;
  const bottom: PlayerInfo = bottomIsWhite ? gs.white : gs.black;
  const clockOf = (p: PlayerInfo) => (p.color === "w" ? gs.clockWMs : gs.clockBMs);
  const runs = (p: PlayerInfo) => gs.status === "live" && gs.turn === p.color;
  const leadOf = (p: PlayerInfo) => {
    const d = p.color === "w" ? cap.w - cap.b : cap.b - cap.w;
    return d > 0 ? d : undefined;
  };

  const drawIncoming = !!drawOffer && drawOffer.by !== playerId && !!myColor && gs.status === "live"
    && now - drawOffer.at < 30_000 && declinedDrawAt !== drawOffer.at;
  const drawPending = drawSentAt !== null && now - drawSentAt < 30_000;
  const rematchIncoming = !!rematchOfferedBy && rematchOfferedBy !== playerId && rematchState !== "sending";

  // One plain line saying what is going on.
  const toMove = gs.turn === "w" ? gs.white : gs.black;
  const check = !ended && inCheck(parseFEN(gs.fen));
  let statusLine: string;
  if (reviewing) {
    statusLine = reviewPly === 0
      ? "Reviewing the starting position."
      : `Reviewing ${Math.ceil(reviewPly / 2)}.${reviewPly % 2 === 0 ? ".." : ""} ${line.san[reviewPly - 1] ?? ""}`;
  }
  else if (ended) statusLine = "Game over.";
  else if (!myColor) statusLine = gs.status === "waiting" ? "Waiting for the first move." : `Watching live. ${toMove.handle} to move.`;
  else if (iAmOnMove) {
    statusLine = check ? "Check! Your move." : "Your move.";
    if (livePly === 0) statusLine += " Make your first move within 30 seconds.";
    else if (livePly === 1) statusLine += " Reply within 30 seconds or the game is called off.";
  } else if (livePly === 0) statusLine = `Waiting for ${toMove.handle} to make the first move.`;
  else statusLine = check ? `Check! ${toMove.handle} is thinking…` : `${toMove.handle} is thinking…`;

  const showEnd = ended && !endHidden && !reviewing;
  const won = !!myColor && ((gs.result === "white" && myColor === "w") || (gs.result === "black" && myColor === "b"));

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      {ended && won && gs.reason === "checkmate" && <Confetti />}

      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="font-display text-[22px] font-extrabold leading-none" style={{ color: "rgb(var(--ink))" }} aria-label="Final Move home">
          Final <span style={{ color: "rgb(var(--violet))" }}>Move</span>
        </Link>
        <div className="flex items-center gap-2">
          <span
            className="mr-1 hidden items-center gap-1.5 text-[12px] font-extrabold sm:inline-flex"
            style={{ color: connected ? "rgb(var(--ink-2))" : "rgb(var(--coral))" }}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: connected ? "rgb(var(--mint))" : "rgb(var(--amber))", border: "1.5px solid rgb(var(--ink))" }} />
            {connected ? "Live" : "Reconnecting"}
          </span>
          <IconButton label={muted ? "Turn sound on" : "Turn sound off"} pressed={muted} onClick={() => setMuted(!muted)}>
            <SoundIcon muted={muted} />
          </IconButton>
          <IconButton label="Flip the board" pressed={manualFlip} onClick={() => setManualFlip((v) => !v)}>
            <FlipIcon />
          </IconButton>
          <ThemeToggle className="!h-9 !w-9" />
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[980px] flex-1 grid-cols-1 items-start gap-5 px-4 pb-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Board column */}
        <section className="mx-auto flex w-full max-w-[600px] flex-col gap-3" aria-label="Board">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1"><PlayerBar player={top} active={runs(top)} isMe={top.color === myColor} lead={leadOf(top)} /></div>
            <Clock ms={clockOf(top)} running={runs(top)} label={`${top.handle} clock`} onLowTime={top.color === myColor ? sfx.lowTime : undefined} />
          </div>

          <div className="relative">
            <PlayBoard
              fen={displayFen}
              legalMoves={legal}
              myColor={myColor}
              turn={pos.turn}
              lastUci={lastUci}
              flipped={manualFlip}
              onMove={sendMove}
              onIllegal={sfx.illegal}
              disabled={!iAmOnMove || reviewing}
              lastMoveState={lastMoveState}
            />
            {showEnd && (
              <EndCard
                gs={gs}
                myColor={myColor}
                delta={myColor && ratingDelta ? (myColor === "w" ? ratingDelta.white : ratingDelta.black) : null}
                finalCount={finalCount}
                lastHash={lastHash}
                rematch={{
                  state: rematchState === "idle" && rematchIncoming ? "incoming" : rematchState,
                  error: rematchError,
                  canRematch: !!myColor && gs.status === "ended" && gs.result !== "aborted",
                }}
                onRematch={handleRematch}
                onHide={() => setEndHidden(true)}
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1"><PlayerBar player={bottom} active={runs(bottom)} isMe={bottom.color === myColor} lead={leadOf(bottom)} /></div>
            <Clock ms={clockOf(bottom)} running={runs(bottom)} label={`${bottom.handle} clock`} onLowTime={bottom.color === myColor ? sfx.lowTime : undefined} />
          </div>

          {/* Status and actions */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              className="min-h-[24px] text-[15px] font-extrabold"
              style={{ color: check && iAmOnMove ? "rgb(var(--coral))" : iAmOnMove ? "rgb(var(--violet))" : "rgb(var(--ink-2))" }}
              aria-live="polite"
            >
              {statusLine}
            </p>
            {gs.mode === "pure" && (
              <span className="chip" style={{ background: "rgb(var(--amber))", color: "rgb(var(--candy-ink))" }} title="Agent duel with no legal move list and no outside help. Each move comes from the model's own reasoning.">
                Pure reasoning
              </span>
            )}
            {reviewing && (
              <button type="button" onClick={() => setReviewPly(null)} className="chip" style={{ background: "rgb(var(--violet))", color: "#fff" }}>
                Back to live
              </button>
            )}
            {ended && endHidden && (
              <button type="button" onClick={() => setEndHidden(false)} className="chip" style={{ background: "rgb(var(--amber))" }}>
                Show result
              </button>
            )}
          </div>

          {drawIncoming && (
            <div className="sticker-card-sm flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ background: "rgb(var(--violet-light))" }} role="alert">
              <span className="font-display text-[16px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>{opponent?.handle ?? "Your opponent"} offers a draw</span>
              <div className="flex gap-2">
                <button type="button" className="pop-btn min-h-[38px] px-4 text-[14px]" onClick={() => { void post("draw-offer"); }}>Accept</button>
                <button type="button" className="pop-btn pop-btn-ghost min-h-[38px] px-4 text-[14px]" onClick={() => setDeclinedDrawAt(drawOffer?.at ?? null)}>Decline</button>
              </div>
            </div>
          )}

          {myColor && playing && !reviewing && (
            <MoveInput fen={gs.fen} enabled={iAmOnMove} onMove={sendMove} />
          )}

          {myColor && gs.status === "live" && (
            confirmResign ? (
              <div className="sticker-card-sm flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="font-display text-[16px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Resign this game?</span>
                <div className="flex gap-2">
                  <button type="button" className="pop-btn pop-btn-danger min-h-[38px] px-4 text-[14px]" onClick={() => { setConfirmResign(false); void post("resign"); }}>Yes, resign</button>
                  <button type="button" className="pop-btn pop-btn-ghost min-h-[38px] px-4 text-[14px]" onClick={() => setConfirmResign(false)} autoFocus>Keep playing</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2.5">
                {!vsBot && (
                  <button
                    type="button"
                    disabled={drawPending}
                    onClick={async () => { if (await post("draw-offer")) setDrawSentAt(Date.now()); }}
                    className="pop-btn pop-btn-ghost flex-1 px-3 text-[14px]"
                  >
                    {drawPending ? "Draw offered" : "Offer draw"}
                  </button>
                )}
                <button type="button" onClick={() => setConfirmResign(true)} className="pop-btn pop-btn-ghost flex-1 px-3 text-[14px]" style={{ color: "rgb(var(--coral))" }}>
                  Resign
                </button>
              </div>
            )
          )}
          {actionError && <p className="text-[13px] font-bold" style={{ color: "rgb(var(--coral))" }} role="alert">{actionError}</p>}
        </section>

        {/* Side panel */}
        <aside className="sticker-card mx-auto w-full max-w-[600px] p-4 lg:sticky lg:top-4" aria-label="Game record">
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-full p-1" style={{ background: "rgb(var(--sky-2))", border: "2px solid rgb(var(--ink))" }} role="tablist">
            {(["moves", "chain"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className="min-h-[36px] rounded-full text-[14px] font-extrabold transition-colors"
                style={{
                  background: tab === t ? "rgb(var(--cloud))" : "transparent",
                  color: "rgb(var(--ink))",
                  boxShadow: tab === t ? "0 0 0 2px rgb(var(--ink))" : undefined,
                }}
              >
                {t === "moves" ? "Moves" : <>On Arc <span className="tabular-nums" style={{ color: "rgb(var(--ink-3))" }}>{finalCount}</span></>}
              </button>
            ))}
          </div>

          {tab === "moves" ? (
            <>
              <MoveList sans={line.san} livePly={livePly} reviewPly={reviewPly} onPick={(p) => setReviewPly(p >= livePly ? null : p)} />
              {livePly > 0 && (
                <div className="mt-3 grid grid-cols-4 gap-1.5" aria-label="Step through the game">
                  {[
                    { label: "First position", glyph: "⏮", go: () => setReviewPly(0) },
                    { label: "Previous move", glyph: "◀", go: () => setReviewPly((r) => Math.max(0, (r ?? livePly) - 1)) },
                    { label: "Next move", glyph: "▶", go: () => setReviewPly((r) => (r === null || r + 1 >= livePly ? null : r + 1)) },
                    { label: "Live position", glyph: "⏭", go: () => setReviewPly(null) },
                  ].map((b) => (
                    <button
                      key={b.label}
                      type="button"
                      onClick={b.go}
                      aria-label={b.label}
                      title={b.label}
                      className="min-h-[38px] rounded-xl text-[13px] font-extrabold transition-colors hover:bg-[rgb(var(--violet-light))]"
                      style={{ border: "2px solid rgb(var(--ink))", color: "rgb(var(--ink))", background: "rgb(var(--cloud))" }}
                    >
                      {b.glyph}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <ChainRecord entries={chainRail} sans={line.san} plyCount={livePly} />
          )}
        </aside>
      </main>

      {!connected && (
        <div
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 px-5 py-2.5 font-display text-[15px] font-extrabold"
          style={{
            background: "rgb(var(--cloud))",
            color: "rgb(var(--ink))",
            border: "var(--line) solid rgb(var(--ink))",
            borderRadius: "var(--r-pill)",
            boxShadow: "4px 4px 0 rgb(var(--pop-shadow))",
          }}
          role="status"
        >
          <span className="h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: "rgb(var(--amber))" }} />
          Reconnecting to the game…
        </div>
      )}
    </div>
  );
}
