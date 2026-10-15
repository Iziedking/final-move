"use client";
import type React from "react";
import type { ChainRailEntry } from "@/lib/types";
import { shortAddr, explorerTx } from "@/lib/utils";

const STATE_COLOR: Record<ChainRailEntry["state"], string> = {
  queued:   "rgb(var(--ink-3))",
  sent:     "rgb(var(--amber))",
  complete: "rgb(var(--amber))",
  final:    "rgb(var(--teal))",
};
const STATE_LABEL: Record<ChainRailEntry["state"], string> = {
  queued:   "queued",
  sent:     "sent",
  complete: "complete",
  final:    "final ✓",
};

export function ChainRail({ entries }: { entries: ChainRailEntry[] }): React.JSX.Element {
  const finalCount = entries.filter((e) => e.state === "final").length;

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* Summary chip */}
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full flex-shrink-0"
          style={{ background: finalCount > 0 ? "rgb(var(--teal))" : "rgb(var(--ink-3))" }}
        />
        <span className="text-xs font-bold font-display" style={{ color: "rgb(var(--ink-2))" }}>
          {finalCount} / {entries.length} moves final on Arc
        </span>
      </div>

      {/* Per-ply rows, newest first */}
      <div className="max-h-[280px] overflow-y-auto flex flex-col gap-1.5 pr-0.5">
        {entries.map((e) => (
          <div
            key={e.ply}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] border-2"
            style={{
              background:  "rgb(var(--cloud))",
              borderColor: e.state === "final" ? "rgb(var(--teal))" : "rgb(var(--ink) / 0.12)",
            }}
          >
            <span
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{ background: STATE_COLOR[e.state] }}
            />
            <span className="font-bold w-5 shrink-0 tabular-nums font-display" style={{ color: "rgb(var(--ink))" }}>
              {e.ply}
            </span>
            <span className="mono shrink-0 font-semibold" style={{ color: "rgb(var(--ink-2))" }}>{e.san}</span>

            <span className="ml-auto text-[10px] font-bold shrink-0" style={{ color: STATE_COLOR[e.state] }}>
              {STATE_LABEL[e.state]}
            </span>

            {e.finalMs !== undefined && (
              <span className="mono text-[10px] shrink-0" style={{ color: "rgb(var(--ink-3))" }}>
                {e.finalMs}ms
              </span>
            )}

            {e.txHash && (
              <a
                href={explorerTx(e.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="mono text-[10px] underline shrink-0 hover:opacity-70"
                style={{ color: "rgb(var(--teal))" }}
                title={e.txHash}
              >
                {shortAddr(e.txHash)}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
