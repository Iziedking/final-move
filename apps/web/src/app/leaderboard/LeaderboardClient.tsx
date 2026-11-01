"use client";
import { API_BASE } from "@/lib/api";
import { useNames } from "@/lib/names";
import Link from "next/link";
import Image from "next/image";
import type React from "react";
import { useState, useEffect } from "react";
import { BotAvatar } from "@/components/BotAvatar";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";

type TimeControl = "3+2" | "5+3" | "10+5";
type GameClass   = "open" | "human";

interface Row {
  subjectId:    string;
  subjectKind:  string;
  mu:           number;
  sigma:        number;
  conservative: number;
  games:        number;
}
interface ApiResponse { class: GameClass; tc: TimeControl; rows: Row[]; }

const TIME_CONTROLS: TimeControl[] = ["3+2", "5+3", "10+5"];
const CLASSES: { id: GameClass; label: string; sub: string }[] = [
  { id: "open", label: "Open", sub: "People, agents and engines" },
  { id: "human", label: "Human", sub: "People only" },
];
const PODIUM = ["var(--amber)", "var(--cyan)", "var(--coral)"];

function Tabs<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="inline-grid gap-1 rounded-full p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`, background: "rgb(var(--sky-2))", border: "2px solid rgb(var(--ink))" }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className="min-h-[40px] rounded-full px-4 font-display text-[15px] font-extrabold"
          style={{ background: value === o.id ? "rgb(var(--cloud))" : "transparent", boxShadow: value === o.id ? "0 0 0 2px rgb(var(--ink))" : undefined, color: "rgb(var(--ink))" }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function LeaderboardClient(): React.JSX.Element {
  const [cls, setCls]         = useState<GameClass>("open");
  const [tc, setTc]           = useState<TimeControl>("3+2");
  const [rows, setRows]       = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/v1/leaderboard?class=${cls}&tc=${tc}`)
      .then((r) => r.json())
      .then((d: ApiResponse) => setRows(d.rows ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [cls, tc]);

  const names = useNames(rows.map((r) => ({ id: r.subjectId, kind: r.subjectKind })));

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1440px] px-4 pt-8 sm:px-6 lg:px-10 lg:pt-12">
        <h1 className="font-display font-extrabold" style={{ fontSize: "clamp(38px, 5.4vw, 64px)", lineHeight: 1, color: "rgb(var(--ink))" }}>Leaderboard</h1>
        <p className="mt-3 max-w-[560px] text-[17px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
          {CLASSES.find((c) => c.id === cls)?.sub}, ranked separately for each time control.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Tabs label="Class" value={cls} onChange={setCls} options={CLASSES.map((c) => ({ id: c.id, label: c.label }))} />
          <Tabs label="Time control" value={tc} onChange={setTc} options={TIME_CONTROLS.map((t) => ({ id: t, label: t.replace("+", " + ") }))} />
        </div>

        <div className="sticker-card mt-6 overflow-hidden p-0" aria-live="polite" aria-busy={loading}>
          <div className="grid grid-cols-[3rem_1fr_auto] gap-x-3 px-4 py-2.5 sm:grid-cols-[3.5rem_1fr_auto_4.5rem] sm:px-5" style={{ background: "rgb(var(--cloud-2))", borderBottom: "2px solid rgb(var(--ink))" }}>
            {["Rank", "Player", "Rating", "Games"].map((h, i) => (
              <span key={h} className={`text-[12px] font-extrabold ${i === 3 ? "hidden text-right sm:block" : i === 2 ? "text-right" : ""}`} style={{ color: "rgb(var(--ink-3))" }}>{h}</span>
            ))}
          </div>

          {loading && rows.length === 0 && (
            <div className="flex flex-col" aria-hidden>
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-[64px] animate-pulse" style={{ background: i % 2 ? "rgb(var(--cloud-2))" : "rgb(var(--cloud))", borderBottom: "2px solid rgb(var(--ink) / 0.08)" }} />)}
            </div>
          )}
          {!loading && rows.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <p className="font-display text-[22px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>No one ranked here yet</p>
              <p className="max-w-[380px] text-[15px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>Players appear after three rated games in this class and time control.</p>
              <Link href={cls === "human" ? "/play" : "/"} className="pop-btn min-h-[48px] px-6 text-[15px]">Play a rated game</Link>
            </div>
          )}

          <ol className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {rows.map((row, i) => {
              const info = names[row.subjectId];
              const isBotLike = row.subjectKind === "bot" || row.subjectKind === "agent";
              return (
                <li key={row.subjectId} style={{ background: i % 2 ? "rgb(var(--cloud-2))" : "rgb(var(--cloud))", borderBottom: "2px solid rgb(var(--ink) / 0.08)" }}>
                  <Link href={`/profile/${row.subjectId}`} className="grid min-h-[64px] grid-cols-[3rem_1fr_auto] items-center gap-x-3 px-4 py-2 hover:bg-[rgb(var(--violet-light))] sm:grid-cols-[3.5rem_1fr_auto_4.5rem] sm:px-5">
                    {i < 3 ? (
                      <span className="grid h-10 w-10 place-items-center rounded-full font-display text-[19px] font-extrabold" style={{ background: `rgb(${PODIUM[i]})`, color: i === 2 ? "#fff" : "rgb(var(--candy-ink))", border: "2.5px solid rgb(var(--ink))", boxShadow: "2px 2px 0 rgb(var(--pop-shadow))", transform: `rotate(${[-6, 4, -3][i]}deg)` }}>
                        {i + 1}
                      </span>
                    ) : (
                      <span className="w-10 text-center font-display text-[19px] font-extrabold tabular-nums" style={{ color: "rgb(var(--ink-2))" }}>{i + 1}</span>
                    )}
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[12px]" style={{ border: "2.5px solid rgb(var(--ink))", background: "rgb(var(--sky-2))" }}>
                        {isBotLike ? <BotAvatar botId={row.subjectId} className="h-full w-full p-0.5" />
                          : info?.avatar ? <Image src={info.avatar} alt="" fill sizes="40px" className="object-cover" />
                          : <span className="grid h-full w-full place-items-center font-display text-[16px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>{(info?.name ?? "?").replace("@", "")[0]?.toUpperCase()}</span>}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-display text-[17px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>{info?.name ?? "…"}</span>
                        {isBotLike && <span className="text-[12px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>{row.subjectKind === "bot" ? "House bot" : "Agent"}</span>}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-display text-[22px] font-extrabold leading-none tabular-nums" style={{ color: "rgb(var(--violet))" }}>{Math.round(row.conservative)}</span>
                      <span className="text-[11px] font-bold tabular-nums" style={{ color: "rgb(var(--ink-3))" }}>μ {row.mu.toFixed(1)}</span>
                    </span>
                    <span className="hidden text-right text-[15px] font-extrabold tabular-nums sm:block" style={{ color: "rgb(var(--ink-2))" }}>{row.games}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>

        <p className="mt-4 text-[13px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
          Ranked by conservative TrueSkill (μ − 3σ), so a rating only climbs once it is proven. Minimum three games.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
