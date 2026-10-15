"use client";
import type React from "react";
import { fmtClock } from "@/lib/utils";

interface ClockProps {
  ms: number;
  running: boolean;
  low?: boolean;
}

export function Clock({ ms, running, low }: ClockProps): React.JSX.Element {
  const isLow = low ?? ms < 20_000;
  const bg = isLow && running
    ? "rgb(var(--danger))"
    : running
    ? "rgb(var(--teal))"
    : "rgb(var(--cloud-2))";
  const color  = running ? "#fff" : "rgb(var(--ink))";
  const border = running
    ? (isLow ? "2px solid rgb(var(--danger))" : "2px solid rgb(var(--teal))")
    : "2px solid rgb(var(--ink) / 0.2)";

  return (
    <div
      className="inline-flex items-center justify-center rounded-2xl px-4 py-2 font-display font-extrabold tabular-nums transition-colors text-[clamp(20px,5.5vw,30px)]"
      style={{
        background: bg,
        color,
        border,
        boxShadow: running ? "3px 3px 0 rgb(var(--pop-shadow))" : "none",
      }}
      aria-live="off"
    >
      {fmtClock(ms)}
    </div>
  );
}
