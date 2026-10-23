"use client";
/**
 * A player's clock: big Baloo numerals in their own sticker card.
 * The server sends the remaining time with every update; while running, the
 * display counts down locally from that reading so it never looks frozen.
 * Running is mint; under 20 s it turns coral and pulses once per second.
 */
import type React from "react";
import { useEffect, useRef, useState } from "react";

interface ClockProps {
  ms: number;
  running: boolean;
  /** Smaller variant for compact layouts. */
  compact?: boolean;
  label?: string;
}

function fmt(ms: number): string {
  const clamped = Math.max(0, ms);
  const total = Math.floor(clamped / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  // Under 10 s show tenths: the last seconds are where games are won.
  if (clamped < 10_000) return `${s}.${Math.floor((clamped % 1000) / 100)}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Clock({ ms, running, compact = false, label }: ClockProps): React.JSX.Element {
  const since = useRef(performance.now());
  const [now, setNow] = useState(() => performance.now());

  // Every new server reading resets the local reference.
  useEffect(() => { since.current = performance.now(); setNow(since.current); }, [ms, running]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(t);
  }, [running]);

  const shown = running ? ms - (now - since.current) : ms;
  const low = shown < 20_000;
  const bg = running ? (low ? "rgb(var(--coral))" : "rgb(var(--mint))") : "rgb(var(--cloud))";
  const fg = running && low ? "#fff" : "rgb(var(--candy-ink))";

  return (
    <div
      role="timer"
      aria-label={`${label ?? "Clock"}: ${fmt(shown)}${running ? ", running" : ""}`}
      className={`inline-flex shrink-0 items-center justify-center font-display font-extrabold tabular-nums leading-none ${compact ? "min-w-[78px] px-3 py-1.5 text-[22px]" : "min-w-[96px] px-4 py-2 text-[clamp(24px,6vw,34px)]"}`}
      style={{
        background: bg,
        color: running ? fg : "rgb(var(--ink))",
        border: "var(--line) solid rgb(var(--ink))",
        borderRadius: "var(--r)",
        boxShadow: running ? "4px 4px 0 rgb(var(--pop-shadow))" : "2px 2px 0 rgb(var(--pop-shadow))",
        opacity: running ? 1 : 0.85,
        animation: running && low ? "clock-pulse 1s steps(1) infinite" : undefined,
        transition: "background-color 200ms, box-shadow 200ms",
      }}
    >
      {fmt(shown)}
    </div>
  );
}
