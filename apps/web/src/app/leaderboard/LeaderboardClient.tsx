"use client";
import type React from "react";
import { useState, useEffect } from "react";
import { cx } from "@/lib/utils";

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

interface ApiResponse {
  class: GameClass;
  tc:    TimeControl;
  rows:  Row[];
}

const TIME_CONTROLS: TimeControl[] = ["3+2", "5+3", "10+5"];
const CLASSES: GameClass[]         = ["open", "human"];

export function LeaderboardClient(): React.JSX.Element {
  const [cls, setCls]       = useState<GameClass>("open");
  const [tc, setTc]         = useState<TimeControl>("3+2");
  const [rows, setRows]     = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
    fetch(`${serverUrl}/v1/leaderboard?class=${cls}&tc=${tc}`)
      .then((r) => r.json())
      .then((d: ApiResponse) => setRows(d.rows ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [cls, tc]);

  return (
    <div className="min-h-screen bg-sky">
      <header className="flex items-center justify-between px-4 py-3 border-b-[3px] border-ink bg-cloud shadow-pop-press">
        <a href="/" className="font-display font-bold text-xl text-ink">Final Move</a>
        <span className="font-body text-sm text-ink-2">Leaderboard</span>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 flex flex-col gap-4">
        {/* Class tabs */}
        <div className="flex gap-2">
          {CLASSES.map((c) => (
            <button
              key={c}
              onClick={() => setCls(c)}
              className={cx(
                "flex-1 rounded-chunk border-[2px] border-ink py-2 font-display font-bold text-[13px] shadow-pop-press transition-all capitalize",
                cls === c ? "bg-violet text-cloud" : "bg-cloud text-ink hover:bg-cloud-2",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Time control pills */}
        <div className="flex gap-2">
          {TIME_CONTROLS.map((t) => (
            <button
              key={t}
              onClick={() => setTc(t)}
              className={cx(
                "rounded-pill border-[2px] border-ink px-3 py-1 font-body font-bold text-[12px] shadow-pop-press transition-all",
                tc === t ? "bg-amber text-ink" : "bg-cloud text-ink hover:bg-cloud-2",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-chunk border-[3px] border-ink bg-cloud shadow-pop overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 px-4 py-2 border-b-[2px] border-ink bg-cloud-2">
            <span className="font-body font-bold text-[11px] text-ink-3">#</span>
            <span className="font-body font-bold text-[11px] text-ink-3">Player</span>
            <span className="font-body font-bold text-[11px] text-ink-3 text-right">Rating</span>
            <span className="font-body font-bold text-[11px] text-ink-3 text-right">Games</span>
          </div>

          {loading && (
            <div className="px-4 py-8 text-center font-body text-sm text-ink-3 animate-pulse">
              Loading…
            </div>
          )}

          {!loading && rows.length === 0 && (
            <div className="px-4 py-8 text-center font-body text-sm text-ink-3">
              No players yet — play a game to appear here.
            </div>
          )}

          {rows.map((row, i) => (
            <div
              key={row.subjectId}
              className={cx(
                "grid grid-cols-[auto_1fr_auto_auto] gap-x-3 px-4 py-3 items-center border-b border-ink/10",
                i === 0 && "bg-amber/10",
              )}
            >
              <span className="font-display font-bold text-sm text-ink-2 w-6 text-center">
                {i === 0 ? "♛" : i + 1}
              </span>

              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base">{row.subjectKind === "bot" ? "🤖" : "♟"}</span>
                <span className="font-body text-sm text-ink truncate">
                  {row.subjectId.startsWith("bot_") ? row.subjectId : `@${row.subjectId}`}
                </span>
              </div>

              <div className="text-right">
                <div className="font-display font-bold text-sm text-violet">
                  {Math.round(row.conservative)}
                </div>
                <div className="font-mono text-[10px] text-ink-3">
                  μ{row.mu.toFixed(1)}
                </div>
              </div>

              <div className="font-body text-sm text-ink-2 text-right w-10">
                {row.games}
              </div>
            </div>
          ))}
        </div>

        <p className="font-body text-[11px] text-ink-3 text-center">
          Ranked by conservative TrueSkill rating (μ − 3σ). Minimum 3 games.
        </p>
      </main>
    </div>
  );
}
