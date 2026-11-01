"use client";
import { API_BASE } from "@/lib/api";
import { useNames } from "@/lib/names";
import Link from "next/link";
import Image from "next/image";
import type React from "react";
import { useState, useEffect } from "react";
import { BotAvatar } from "@/components/BotAvatar";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";

interface GameRow {
  id:           string;
  white_id:     string;
  black_id:     string;
  white_kind:   string;
  black_kind:   string;
  time_control: string;
  status:       string;
  ply_count:    number;
  created_at:   string;
}

const KIND_CHIP: Record<string, { label: string; bg: string } | undefined> = {
  bot: { label: "Bot", bg: "var(--cyan)" },
  agent: { label: "Agent", bg: "var(--amber)" },
};

function Side({ id, kind, color, name, avatar, align }: { id: string; kind: string; color: "w" | "b"; name: string; avatar?: string | null; align: "left" | "right" }) {
  const chip = KIND_CHIP[kind];
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-2.5 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[12px]" style={{ border: "2.5px solid rgb(var(--ink))", background: "rgb(var(--sky-2))" }}>
        {kind === "bot" || kind === "agent" ? (
          <BotAvatar botId={id} className="h-full w-full p-0.5" />
        ) : avatar ? (
          <Image src={avatar} alt="" fill sizes="44px" className="object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center font-display text-[17px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>{name.replace("@", "")[0]?.toUpperCase() ?? "?"}</span>
        )}
      </span>
      <span className="min-w-0">
        <span className={`flex items-center gap-1.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
          <span className="h-3 w-3 shrink-0 rounded-full" role="img" aria-label={color === "w" ? "white" : "black"} style={{ background: color === "w" ? "#fff" : "rgb(var(--piece-black))", border: "2px solid rgb(var(--piece-line))" }} />
          <span className="truncate font-display text-[17px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>{name}</span>
        </span>
        {chip && <span className="chip mt-1 py-0 text-[10px]" style={{ background: `rgb(${chip.bg})`, color: "rgb(var(--candy-ink))" }}>{chip.label}</span>}
      </span>
    </div>
  );
}

export function WatchClient(): React.JSX.Element {
  const [games, setGames]     = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed]   = useState(false);

  useEffect(() => {
    const load = () => {
      fetch(`${API_BASE}/v1/watch`)
        .then((r) => r.json())
        .then((d: { games: GameRow[] }) => { setGames(d.games ?? []); setFailed(false); setLoading(false); })
        .catch(() => { setFailed(true); setLoading(false); });
    };
    load();
    const iv = setInterval(load, 5_000);
    return () => clearInterval(iv);
  }, []);

  const names = useNames(games.flatMap((g) => [{ id: g.white_id, kind: g.white_kind }, { id: g.black_id, kind: g.black_kind }]));
  const nameOf = (id: string) => names[id]?.name ?? (id.startsWith("guest") ? "Guest" : "…");

  const live = games.filter((g) => g.status === "live" || g.status === "waiting");
  const recent = games.filter((g) => g.status === "ended" || g.status === "aborted");

  const card = (g: GameRow) => {
    const isLive = g.status === "live" || g.status === "waiting";
    return (
      <Link
        key={g.id}
        href={isLive ? `/game/${g.id}` : `/g/${g.id}`}
        className="sticker-card flex flex-col gap-4 p-5 transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_rgb(var(--pop-shadow))]"
      >
        <div className="flex items-center justify-between gap-2">
          {isLive ? (
            <span className="chip" style={{ background: "rgb(var(--mint))", color: "rgb(var(--candy-ink))" }}>
              <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: "rgb(var(--ink))" }} />
              {g.status === "waiting" ? "STARTING" : "LIVE"}
            </span>
          ) : (
            <span className="chip" style={{ background: "rgb(var(--cloud-2))", color: "rgb(var(--ink-2))" }}>{g.status === "aborted" ? "CALLED OFF" : "FINISHED"}</span>
          )}
          <span className="text-[13px] font-extrabold tabular-nums" style={{ color: "rgb(var(--ink-3))" }}>
            {g.time_control.replace("+", " + ")}{isLive ? ` · move ${Math.ceil(g.ply_count / 2) || 1}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Side id={g.white_id} kind={g.white_kind} color="w" name={nameOf(g.white_id)} avatar={names[g.white_id]?.avatar} align="left" />
          <span className="shrink-0 font-display text-[15px] font-extrabold" style={{ color: "rgb(var(--ink-3))" }}>vs</span>
          <Side id={g.black_id} kind={g.black_kind} color="b" name={nameOf(g.black_id)} avatar={names[g.black_id]?.avatar} align="right" />
        </div>
        <span className="text-[14px] font-extrabold" style={{ color: "rgb(var(--violet))" }}>{isLive ? "Watch live" : "Replay"} →</span>
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1440px] px-4 pt-8 sm:px-6 lg:px-10 lg:pt-12">
        <h1 className="font-display font-extrabold" style={{ fontSize: "clamp(38px, 5.4vw, 64px)", lineHeight: 1, color: "rgb(var(--ink))" }}>Watch</h1>
        <p className="mt-3 max-w-[560px] text-[17px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
          Games being played right now, and the ones that just ended. Every move you see is landing on Arc.
        </p>

        <div aria-live="polite">
          {loading ? (
            <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3" aria-hidden>
              {[0, 1, 2].map((i) => <div key={i} className="sticker-card h-[170px] animate-pulse" style={{ background: "rgb(var(--cloud-2))" }} />)}
            </div>
          ) : failed && games.length === 0 ? (
            <div className="sticker-card mt-8 max-w-[560px] p-6">
              <p className="font-display text-[22px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>We could not load games</p>
              <p className="mt-1 text-[15px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>Check your connection. This page retries every few seconds.</p>
            </div>
          ) : (
            <>
              <h2 className="mb-4 mt-10 font-display text-[26px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>
                Live now <span className="tabular-nums" style={{ color: "rgb(var(--ink-3))" }}>{live.length}</span>
              </h2>
              {live.length === 0 ? (
                <div className="sticker-card flex max-w-[560px] flex-col items-start gap-3 p-6">
                  <p className="font-display text-[22px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Nobody is playing right now</p>
                  <p className="text-[15px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>Start a game and it shows up here for anyone to watch.</p>
                  <Link href="/" className="pop-btn min-h-[48px] px-6 text-[15px]">Play now</Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">{live.map(card)}</div>
              )}

              {recent.length > 0 && (
                <>
                  <h2 className="mb-4 mt-12 font-display text-[26px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Just finished</h2>
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">{recent.map(card)}</div>
                </>
              )}
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
