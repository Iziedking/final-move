"use client";
import type { ChainRailEntry } from "@/lib/types";
import { shortAddr, explorerTx, cx } from "@/lib/utils";

const STATE_DOT: Record<ChainRailEntry["state"], string> = {
  queued:   "bg-ink-3",
  sent:     "bg-cyan",
  complete: "bg-cyan",
  final:    "bg-mint",
};

const STATE_LABEL: Record<ChainRailEntry["state"], string> = {
  queued:   "queued",
  sent:     "sent",
  complete: "complete",
  final:    "final",
};

export function ChainRail({ entries }: { entries: ChainRailEntry[] }): React.JSX.Element {
  const finalCount = entries.filter((e) => e.state === "final").length;

  return (
    <div className="flex flex-col gap-1 w-full">
      {/* Summary chip */}
      <div className="flex items-center gap-2 rounded-pill border-[2px] border-ink bg-cloud px-3 py-1.5 shadow-pop-press text-[12px] font-body font-bold text-ink">
        <span className={cx("h-2 w-2 rounded-full flex-shrink-0", finalCount > 0 ? "bg-mint" : "bg-ink-3")} />
        <span>{finalCount} / {entries.length} moves final on Arc</span>
      </div>

      {/* Per-ply rows (newest first) */}
      <div className="max-h-[300px] overflow-y-auto flex flex-col gap-1 pr-0.5">
        {entries.map((e) => (
          <div
            key={e.ply}
            className="flex items-center gap-2 rounded-chunk border-[2px] border-ink bg-cloud px-3 py-1.5 text-[11px] shadow-pop-press"
          >
            {/* State dot */}
            <span className={cx("h-2 w-2 flex-shrink-0 rounded-full", STATE_DOT[e.state])} />

            {/* Ply + move */}
            <span className="font-body font-bold text-ink w-5 shrink-0">{e.ply}</span>
            <span className="font-mono text-ink-2 shrink-0">{e.san}</span>

            {/* State label */}
            <span className={cx(
              "ml-auto font-body text-[10px] font-bold shrink-0",
              e.state === "final" ? "text-mint" : "text-ink-3",
            )}>
              {STATE_LABEL[e.state]}
            </span>

            {/* Finality time */}
            {e.finalMs !== undefined && (
              <span className="font-mono text-[10px] text-ink-3 shrink-0">{e.finalMs}ms</span>
            )}

            {/* Explorer link */}
            {e.txHash && (
              <a
                href={explorerTx(e.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-violet underline shrink-0 hover:text-violet-deep"
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
