"use client";
import { API_BASE } from "@/lib/api";
import type React from "react";
import { useState, useEffect } from "react";

const API = API_BASE;

interface HvMData {
  humanWins: number; machineWins: number; draws: number; total: number;
  humanPct: number; machinePct: number; drawPct: number;
}

export function HvMScoreboard(): React.JSX.Element {
  const [data, setData] = useState<HvMData | null>(null);

  useEffect(() => {
    const load = () =>
      fetch(`${API}/v1/hvm`).then((r) => r.json()).then((d) => setData(d as HvMData)).catch(() => {});
    void load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, []);

  if (!data) {
    return (
      <div className="sticker-card p-5 animate-pulse">
        <div className="h-3.5 rounded-full w-3/4 mb-3" style={{ background: "rgb(var(--sky-2))" }} />
        <div className="h-3 rounded-full w-full mb-2" style={{ background: "rgb(var(--sky-2))" }} />
        <div className="h-3 rounded-full w-1/2" style={{ background: "rgb(var(--sky-2))" }} />
      </div>
    );
  }

  return (
    <div className="sticker-card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-display font-bold text-sm" style={{ color: "rgb(var(--ink))" }}>
          Humans vs Machines
        </span>
        <span className="chip">{data.total} games</span>
      </div>

      {/* Bar */}
      <div
        className="relative h-3.5 rounded-full overflow-hidden flex border-2"
        style={{ borderColor: "rgb(var(--ink))" }}
      >
        <div className="transition-all duration-500" style={{ width: `${data.humanPct}%`,   background: "rgb(var(--teal))"  }} />
        <div className="transition-all duration-500" style={{ width: `${data.drawPct}%`,    background: "rgb(var(--amber))" }} />
        <div className="transition-all duration-500" style={{ width: `${data.machinePct}%`, background: "rgb(var(--coral))" }} />
      </div>

      {/* Legend */}
      <div className="flex justify-between text-xs font-semibold">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full border-2 inline-block" style={{ background: "rgb(var(--teal))",  borderColor: "rgb(var(--ink))" }} />
          <span style={{ color: "rgb(var(--ink-2))" }}>
            Humans <strong style={{ color: "rgb(var(--ink))" }}>{data.humanWins}</strong>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full border-2 inline-block" style={{ background: "rgb(var(--amber))", borderColor: "rgb(var(--ink))" }} />
          <span style={{ color: "rgb(var(--ink-2))" }}>
            Draws <strong style={{ color: "rgb(var(--ink))" }}>{data.draws}</strong>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full border-2 inline-block" style={{ background: "rgb(var(--coral))", borderColor: "rgb(var(--ink))" }} />
          <span style={{ color: "rgb(var(--ink-2))" }}>
            Machines <strong style={{ color: "rgb(var(--ink))" }}>{data.machineWins}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
