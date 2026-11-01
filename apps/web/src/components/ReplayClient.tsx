"use client";
/**
 * Replay of a finished game, rebuilt from the server record and Arc. The board
 * steps through every ply (buttons, arrow keys or autoplay), the move list
 * shows SAN, and each move links to its transaction.
 */
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import Image from "next/image";
import type React from "react";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { START_FEN, sanLine } from "@final-move/chess";
import { PlayBoard } from "@/components/PlayBoard";
import { BotAvatar } from "@/components/BotAvatar";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";
import { botName } from "@/lib/bots";
import type { ChainRailEntry } from "@/lib/types";
import { ARC_EXPLORER } from "@/lib/network";

interface MoveRow {
  ply: number; uci: string; san: string | null; fenAfter: string;
  clockWMs: number; clockBMs: number; state: string;
  txHash: string | null; block: number | null; finalAt: string | null; relayed: boolean;
}

interface GameData {
  game: {
    id: string; whiteName: string; blackName: string; whiteAvatar: string | null;
    blackAvatar: string | null; result: string | null; reason: string | null;
    timeControl: string; chainGameId: string | null; endedAt: string | null;
    whiteAddress: string; blackAddress: string;
    whiteId?: string; whiteKind?: string; blackId?: string; blackKind?: string;
  };
  moves: MoveRow[];
  chainEvents: { eventName: string; args: Record<string, unknown>; txHash: string; blockNumber: number }[];
}

interface Props {
  gameId: string;
  initialData: GameData | null;
}

const REASON_LABEL: Record<string, string> = {
  checkmate: "by checkmate", resignation: "by resignation", timeout: "on time",
  abandon: "by abandonment", stalemate: "by stalemate", repetition: "by repetition",
  "fifty-move": "by the fifty-move rule", "insufficient-material": "by insufficient material",
  agreement: "by agreement", aborted: "",
};

const STATE: Record<string, { dot: string; label: string }> = {
  queued:   { dot: "var(--ink-3)", label: "Queued" },
  sent:     { dot: "var(--cyan)",  label: "Sent" },
  complete: { dot: "var(--cyan)",  label: "Confirming" },
  final:    { dot: "var(--mint)",  label: "Final" },
};

function msToClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function displayName(id: string | undefined, kind: string | undefined, given: string): string {
  if (id && (kind === "bot" || id.startsWith("bot_"))) return botName(id) ?? given;
  if (id?.startsWith("guest")) return "Guest";
  if (id && given === id) return kind === "agent" ? "Agent" : "Player";
  return given;
}

function Side({ name, avatar, id, kind, color, address, won, clock }: {
  name: string; avatar: string | null; id?: string; kind?: string; color: "w" | "b"; address: string; won: boolean; clock?: string;
}) {
  return (
    <div
      className="flex min-w-0 items-center gap-3 px-3 py-2"
      style={{
        background: won ? "rgb(var(--amber))" : "rgb(var(--cloud))",
        border: "var(--line) solid rgb(var(--ink))",
        borderRadius: "var(--r)",
        boxShadow: "2px 2px 0 rgb(var(--pop-shadow))",
      }}
    >
      <div className="relative h-10 w-10 shrink-0 overflow-hidden" style={{ border: "2.5px solid rgb(var(--ink))", borderRadius: 12, background: "rgb(var(--sky-2))" }}>
        {avatar ? (
          <Image src={avatar} alt="" fill sizes="40px" className="object-cover" />
        ) : kind === "bot" || kind === "agent" ? (
          <BotAvatar botId={id} className="h-full w-full p-0.5" />
        ) : (
          <span className="grid h-full w-full place-items-center font-display text-base font-extrabold" style={{ color: "rgb(var(--ink))" }}>{name[0]?.toUpperCase() ?? "?"}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: color === "w" ? "#fff" : "rgb(var(--piece-black))", border: "2px solid rgb(var(--piece-line))" }} role="img" aria-label={color === "w" ? "plays white" : "plays black"} />
          <span className="truncate font-display text-[17px] font-extrabold leading-tight" style={{ color: "rgb(var(--candy-ink))" }}>{name}</span>
          {kind === "bot" && <span className="chip shrink-0 py-0 text-[10px]" style={{ background: "rgb(var(--cyan))", color: "rgb(var(--candy-ink))" }}>Bot</span>}
          {kind === "agent" && <span className="chip shrink-0 py-0 text-[10px]" style={{ background: "rgb(var(--cyan))", color: "rgb(var(--candy-ink))" }}>Agent</span>}
          {won && <span className="chip shrink-0 py-0 text-[10px]" style={{ background: "rgb(var(--cloud))" }}>Winner</span>}
        </div>
        <a href={`${ARC_EXPLORER}/address/${address}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] font-medium hover:underline" style={{ color: won ? "rgb(var(--candy-ink))" : "rgb(var(--ink-3))" }}>
          {address.slice(0, 8)}…{address.slice(-4)}
        </a>
      </div>
      {clock && <span className="font-display text-[20px] font-extrabold tabular-nums" style={{ color: "rgb(var(--candy-ink))" }}>{clock}</span>}
    </div>
  );
}

export function ReplayClient({ gameId, initialData }: Props): React.JSX.Element {
  const [data, setData] = useState<GameData | null>(initialData);
  const [cursor, setCursor] = useState<number>(initialData?.moves.length ?? 0);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [shareNote, setShareNote] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/games/${gameId}/replay`);
      if (res.ok) { const d = await res.json() as GameData; setData(d); setCursor(d.moves.length); }
    } catch { /* keep what we have */ } finally { setLoading(false); }
  }, [gameId]);

  const moves = useMemo(() => data?.moves ?? [], [data]);
  const total = moves.length;
  const sans = useMemo(() => {
    const computed = sanLine(moves.map((m) => m.uci)).san;
    return moves.map((m, i) => m.san ?? computed[i] ?? m.uci);
  }, [moves]);

  // Autoplay: one ply every 900 ms; starting at the end rewinds first.
  useEffect(() => {
    if (!playing) return undefined;
    if (cursor >= total) { setPlaying(false); return undefined; }
    const t = setTimeout(() => setCursor((c) => Math.min(total, c + 1)), 900);
    return () => clearTimeout(t);
  }, [playing, cursor, total]);

  const go = useCallback((to: number) => { setPlaying(false); setCursor(Math.max(0, Math.min(total, to))); }, [total]);
  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p && cursor >= total) setCursor(0);
      return !p;
    });
  }, [cursor, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); go(cursor - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(cursor + 1); }
      else if (e.key === "Home") { e.preventDefault(); go(0); }
      else if (e.key === "End") { e.preventDefault(); go(total); }
      else if (e.key === " " && t?.tagName !== "BUTTON") { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor, total, go, togglePlay]);

  // Keep the current move in view in the list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[aria-current='step']")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}/g/${gameId}`;
    let text = "A game of chess where every move is on Arc.";
    try {
      const res = await fetch(`${API_BASE}/v1/games/${gameId}/share`);
      if (res.ok) text = ((await res.json()) as { xShareText?: string }).xShareText ?? text;
    } catch { /* use the default text */ }
    if (typeof navigator.share === "function") {
      try { await navigator.share({ title: "Final Move replay", text, url }); return; } catch { /* cancelled */ }
    }
    try { await navigator.clipboard.writeText(url); setShareNote("Link copied."); }
    catch { setShareNote(url); }
    setTimeout(() => setShareNote(""), 3000);
  }, [gameId]);

  const xIntent = useCallback(() => {
    const url = encodeURIComponent(`${window.location.origin}/g/${gameId}`);
    window.open(`https://x.com/intent/tweet?url=${url}&text=${encodeURIComponent("Every move of this game is on Arc.")}`, "_blank", "noopener");
  }, [gameId]);

  if (!data) {
    return (
      <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-[1440px] flex-col px-4 pt-10 sm:px-6 lg:px-10">
          <div className="sticker-card flex max-w-[560px] flex-col items-start gap-3 p-6" role="alert">
            <p className="font-display text-[24px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>We could not find this replay</p>
            <p className="text-[15px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>
              The game may still be in progress, or the link may be wrong. Live games can be watched from the game page.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <button type="button" onClick={() => { void load(); }} disabled={loading} className="pop-btn px-5 text-[15px]">
                {loading ? "Checking…" : "Try again"}
              </button>
              <Link href={`/game/${gameId}`} className="pop-btn pop-btn-ghost px-5 text-[15px]">Open the live game</Link>
              <Link href="/" className="pop-btn pop-btn-ghost px-5 text-[15px]">Home</Link>
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const { game } = data;
  const current = cursor > 0 ? moves[cursor - 1] : undefined;
  const fen = current?.fenAfter || START_FEN;
  const turn = (fen.split(" ")[1] ?? "w") as "w" | "b";
  const markState = current ? (Object.keys(STATE).includes(current.state) ? current.state as ChainRailEntry["state"] : undefined) : undefined;
  const finalMoves = moves.filter((m) => m.state === "final").length;

  const whiteName = displayName(game.whiteId, game.whiteKind, game.whiteName);
  const blackName = displayName(game.blackId, game.blackKind, game.blackName);
  const winner = game.result === "white" ? "w" : game.result === "black" ? "b" : null;
  const reason = game.reason ? REASON_LABEL[game.reason] ?? game.reason.replace(/-/g, " ") : "";
  const title = game.result === "white" ? `${whiteName} wins`
    : game.result === "black" ? `${blackName} wins`
    : game.result === "draw" ? "Draw"
    : game.result === "aborted" ? "Game called off"
    : "In progress";
  const stamp = game.result === "draw" ? "rgb(var(--cyan))" : game.result === "aborted" || !game.result ? "rgb(var(--cloud-2))" : "rgb(var(--mint))";

  const whiteClock = current ? msToClock(current.clockWMs) : undefined;
  const blackClock = current ? msToClock(current.clockBMs) : undefined;
  const whiteSide = <Side name={whiteName} avatar={game.whiteAvatar} id={game.whiteId} kind={game.whiteKind} color="w" address={game.whiteAddress} won={winner === "w"} clock={whiteClock} />;
  const blackSide = <Side name={blackName} avatar={game.blackAvatar} id={game.blackId} kind={game.blackKind} color="b" address={game.blackAddress} won={winner === "b"} clock={blackClock} />;

  const rows: Array<[number, number, number | null]> = [];
  for (let i = 1; i <= total; i += 2) rows.push([(i + 1) / 2, i, i + 1 <= total ? i + 1 : null]);

  const ctl = "grid min-h-[44px] place-items-center rounded-xl text-[15px] font-extrabold transition-colors hover:bg-[rgb(var(--violet-light))] disabled:opacity-40";
  const ctlStyle: React.CSSProperties = { border: "2px solid rgb(var(--ink))", color: "rgb(var(--ink))", background: "rgb(var(--cloud))" };

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 pt-8 sm:px-6 lg:px-10">
        {/* Result */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1
            className="inline-block px-4 py-1.5 font-display font-extrabold leading-none"
            style={{
              fontSize: "clamp(28px, 4vw, 44px)",
              background: stamp,
              color: "rgb(var(--candy-ink))",
              border: "var(--line) solid rgb(var(--ink))",
              borderRadius: "var(--r)",
              boxShadow: "4px 4px 0 rgb(var(--pop-shadow))",
              transform: "rotate(-2deg)",
            }}
          >
            {title}
          </h1>
          <p className="text-[16px] font-bold" style={{ color: "rgb(var(--ink-2))" }}>
            {reason && <>{reason.charAt(0).toUpperCase() + reason.slice(1)} · </>}
            {game.timeControl}
            {game.endedAt && <> · {new Date(game.endedAt).toLocaleDateString()}</>}
          </p>
          <span className="chip" style={{ background: "rgb(var(--mint))", color: "rgb(var(--candy-ink))" }}>
            {finalMoves} of {total} moves final on Arc
          </span>
        </div>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Board */}
          <section className="mx-auto flex w-full max-w-[600px] flex-col gap-3" aria-label="Board">
            {flipped ? whiteSide : blackSide}
            <div className="pointer-events-none">
              <PlayBoard fen={fen} legalMoves={[]} myColor={null} turn={turn} lastUci={current?.uci} flipped={flipped} onMove={() => {}} disabled lastMoveState={markState} />
            </div>
            {flipped ? blackSide : whiteSide}

            <div className="grid grid-cols-6 gap-1.5" aria-label="Step through the game">
              <button type="button" className={ctl} style={ctlStyle} onClick={() => go(0)} disabled={cursor === 0} aria-label="Start position" title="Start position (Home)">⏮</button>
              <button type="button" className={ctl} style={ctlStyle} onClick={() => go(cursor - 1)} disabled={cursor === 0} aria-label="Previous move" title="Previous move (←)">◀</button>
              <button
                type="button"
                className={`${ctl} col-span-2`}
                style={{ ...ctlStyle, background: "rgb(var(--violet))", color: "#fff", boxShadow: "3px 3px 0 rgb(var(--pop-shadow))" }}
                onClick={togglePlay}
                disabled={total === 0}
                aria-label={playing ? "Pause" : "Play through the game"}
              >
                {playing ? "Pause" : cursor >= total ? "Replay" : "Play"}
              </button>
              <button type="button" className={ctl} style={ctlStyle} onClick={() => go(cursor + 1)} disabled={cursor >= total} aria-label="Next move" title="Next move (→)">▶</button>
              <button type="button" className={ctl} style={ctlStyle} onClick={() => go(total)} disabled={cursor >= total} aria-label="Final position" title="Final position (End)">⏭</button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[15px] font-extrabold" style={{ color: "rgb(var(--ink-2))" }} aria-live="polite">
                {cursor === 0 ? "Start position" : `${Math.ceil(cursor / 2)}.${cursor % 2 === 0 ? ".." : ""} ${sans[cursor - 1]}`}
                {current && STATE[current.state] && <> · {STATE[current.state]!.label}{current.relayed ? ", relayed by the referee" : ""}</>}
              </p>
              <button type="button" onClick={() => setFlipped((f) => !f)} className="chip min-h-[36px]" aria-pressed={flipped}>Flip board</button>
            </div>
          </section>

          {/* Moves and chain */}
          <aside className="sticker-card flex w-full flex-col gap-3 p-4 lg:sticky lg:top-4" aria-label="Moves">
            <h2 className="font-display text-[20px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Moves</h2>
            {total === 0 ? (
              <p className="text-[15px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>No moves were played in this game.</p>
            ) : (
              <ol ref={listRef} className="flex max-h-[440px] flex-col gap-0.5 overflow-y-auto pr-1">
                {rows.map(([n, w, b]) => (
                  <li key={n} className="grid grid-cols-[2rem_1fr_1fr] items-center gap-1">
                    <span className="text-right text-[12px] font-bold tabular-nums" style={{ color: "rgb(var(--ink-3))" }}>{n}.</span>
                    {[w, b].map((ply) => {
                      if (ply === null) return <span key="empty" />;
                      const m = moves[ply - 1]!;
                      const on = ply === cursor;
                      const st = STATE[m.state];
                      return (
                        <span key={ply} className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => go(ply)}
                            aria-current={on ? "step" : undefined}
                            className="flex min-h-[36px] flex-1 items-center gap-1.5 rounded-lg px-2 text-left font-display text-[15px] font-bold"
                            style={{ background: on ? "rgb(var(--violet))" : "transparent", color: on ? "#fff" : "rgb(var(--ink))" }}
                          >
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: `rgb(${st?.dot ?? "var(--ink-3)"})`, border: "1px solid rgb(var(--ink))" }} aria-label={st?.label ?? m.state} role="img" />
                            {sans[ply - 1]}
                          </button>
                          {m.txHash && (
                            <a
                              href={`${ARC_EXPLORER}/tx/${m.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Move ${ply} on the Arc explorer`}
                              className="grid h-8 w-7 place-items-center rounded-md text-[13px] font-bold hover:bg-[rgb(var(--violet-light))]"
                              style={{ color: "rgb(var(--violet))" }}
                            >
                              ↗
                            </a>
                          )}
                        </span>
                      );
                    })}
                  </li>
                ))}
              </ol>
            )}

            {current?.txHash && (
              <div className="rounded-xl p-3" style={{ background: "rgb(var(--cloud-2))", border: "2px solid rgb(var(--ink) / 0.12)" }}>
                <p className="text-[12px] font-extrabold" style={{ color: "rgb(var(--ink-3))" }}>Move {cursor} transaction</p>
                <a href={`${ARC_EXPLORER}/tx/${current.txHash}`} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-[12px] font-medium hover:underline" style={{ color: "rgb(var(--violet))" }}>
                  {current.txHash}
                </a>
                {current.block !== null && <p className="mt-0.5 font-mono text-[11px]" style={{ color: "rgb(var(--ink-3))" }}>Block {current.block.toLocaleString()}</p>}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => { void handleShare(); }} className="pop-btn px-3 text-[14px]">Share</button>
                <button type="button" onClick={xIntent} className="pop-btn pop-btn-ghost px-3 text-[14px]">Post on X</button>
              </div>
              {shareNote && <p className="break-all text-[13px] font-bold" style={{ color: "rgb(var(--ink-2))" }} aria-live="polite">{shareNote}</p>}
              {game.chainGameId && (
                <a href={`${ARC_EXPLORER}/search?q=${game.chainGameId}`} target="_blank" rel="noopener noreferrer" className="text-center text-[14px] font-extrabold underline decoration-2 underline-offset-2" style={{ color: "rgb(var(--violet))" }}>
                  Verify the whole game on Arc ↗
                </a>
              )}
              <Link href="/" className="pop-btn pop-btn-ghost px-3 text-[14px]">Play a game</Link>
            </div>
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
