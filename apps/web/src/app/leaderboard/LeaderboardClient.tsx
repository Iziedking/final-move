"use client";
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import type React from "react";
import { useState, useEffect } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

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
const CLASSES: GameClass[]         = ["open", "human"];

export function LeaderboardClient(): React.JSX.Element {
  const [cls, setCls]         = useState<GameClass>("open");
  const [tc, setTc]           = useState<TimeControl>("3+2");
  const [rows, setRows]       = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/v1/leaderboard?class=${cls}&tc=${tc}`)
      .then((r) => r.json())
      .then((d: ApiResponse) => setRows(d.rows ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [cls, tc]);

  return (
    <div className="min-h-screen" style={{ background: "rgb(var(--sky))" }}>
      <header
        className="flex items-center justify-between px-4 py-3 border-b-2"
        style={{ background: "rgb(var(--cloud) / 0.85)", borderColor: "rgb(var(--ink) / 0.10)" }}
      >
        <Link href="/" className="font-display font-extrabold text-xl" style={{ color: "rgb(var(--ink))" }}>Final Move</Link>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: "rgb(var(--ink-2))" }}>Leaderboard</span>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 flex flex-col gap-4">
        {/* Class tabs */}
        <div className="flex gap-2">
          {CLASSES.map((c) => (
            <button
              key={c}
              onClick={() => setCls(c)}
              className={`flex-1 rounded-2xl border-2 py-2 font-display font-extrabold text-[13px] transition-all capitalize ${
                cls === c ? "pop-btn" : "pop-btn-ghost pop-btn"
              }`}
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
              className="rounded-full border-2 px-4 py-1 text-[12px] font-bold transition-all"
              style={{
                borderColor: tc === t ? "rgb(var(--ink))"           : "rgb(var(--ink) / 0.2)",
                background:  tc === t ? "rgb(var(--amber))"         : "rgb(var(--cloud))",
                color:       tc === t ? "rgb(var(--candy-ink))"     : "rgb(var(--ink-2))",
                boxShadow:   tc === t ? "2px 2px 0 rgb(var(--pop-shadow))" : "none",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="sticker-card overflow-hidden p-0">
          <div
            className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 px-4 py-2 border-b-2"
            style={{ borderColor: "rgb(var(--ink) / 0.10)", background: "rgb(var(--cloud-2))" }}
          >
            {["#", "Player", "Rating", "Games"].map((h, i) => (
              <span
                key={h}
                className="text-[11px] font-extrabold font-display uppercase tracking-wider"
                style={{ color: "rgb(var(--ink-3))", textAlign: i > 1 ? "right" : "left" }}
              >
                {h}
              </span>
            ))}
          </div>

          {loading && (
            <div className="px-4 py-8 text-center text-sm font-bold animate-pulse" style={{ color: "rgb(var(--ink-3))" }}>
              Loading…
            </div>
          )}
          {!loading && rows.length === 0 && (
            <div className="px-4 py-8 text-center text-sm font-bold" style={{ color: "rgb(var(--ink-3))" }}>
              No players yet — play a game to appear here.
            </div>
          )}

          {rows.map((row, i) => (
            <div
              key={row.subjectId}
              className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 px-4 py-3 items-center border-b-2 last:border-b-0"
              style={{
                borderColor: "rgb(var(--ink) / 0.07)",
                background: i === 0 ? "rgb(var(--amber) / 0.10)" : "transparent",
              }}
            >
              <span className="font-display font-extrabold text-sm w-6 text-center" style={{ color: i === 0 ? "rgb(var(--amber))" : "rgb(var(--ink-2))" }}>
                {i + 1}
              </span>
              <div className="flex items-center gap-2 min-w-0">
                <span className="chip text-[9px] shrink-0">{row.subjectKind === "bot" ? "Bot" : row.subjectKind === "agent" ? "Agent" : "Human"}</span>
                <span className="text-sm font-semibold truncate" style={{ color: "rgb(var(--ink))" }}>
                  {row.subjectId.startsWith("bot_") ? row.subjectId : `@${row.subjectId}`}
                </span>
              </div>
              <div className="text-right">
                <div className="font-display font-extrabold text-sm" style={{ color: "rgb(var(--teal))" }}>
                  {Math.round(row.conservative)}
                </div>
                <div className="font-mono text-[10px]" style={{ color: "rgb(var(--ink-3))" }}>
                  μ{row.mu.toFixed(1)}
                </div>
              </div>
              <div className="text-sm font-bold text-right w-10" style={{ color: "rgb(var(--ink-2))" }}>
                {row.games}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] font-semibold text-center" style={{ color: "rgb(var(--ink-3))" }}>
          Ranked by conservative TrueSkill (μ − 3σ). Minimum 3 games.
        </p>
      </main>
    </div>
  );
}
