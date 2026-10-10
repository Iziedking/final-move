import type React from "react";
import type { PlayerInfo } from "@/lib/types";
import { cx } from "@/lib/utils";
import Image from "next/image";

interface PlayerBarProps {
  player: PlayerInfo;
  active: boolean;
}

export function PlayerBar({ player, active }: PlayerBarProps): React.JSX.Element {
  return (
    <div
      className={cx(
        "flex items-center gap-3 rounded-chunk border-[3px] border-ink px-3 py-2 transition-colors",
        active ? "bg-mint/20 shadow-pop-press" : "bg-cloud",
      )}
    >
      {/* Avatar */}
      <div className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-chunk border-[2px] border-ink bg-cloud-2">
        {player.avatar ? (
          <Image src={player.avatar} alt={player.handle} fill className="object-cover" sizes="36px" />
        ) : (
          <span className="flex h-full w-full items-center justify-center font-display text-lg font-bold text-ink">
            {player.kind === "bot" ? "🤖" : player.handle[0]?.toUpperCase() ?? "?"}
          </span>
        )}
      </div>

      {/* Name + rating */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-[14px] font-bold text-ink">
            {player.handle}
          </span>
          {/* Color indicator */}
          <span
            className="grid h-4 w-4 flex-shrink-0 place-items-center rounded-full border-[2px] border-ink text-[9px]"
            style={{
              background: player.color === "w" ? "#fff" : "rgb(var(--ink))",
              color: player.color === "w" ? "rgb(var(--ink))" : "#fff",
            }}
            aria-label={player.color === "w" ? "white" : "black"}
          >
            ♚
          </span>
          {active && (
            <span className="rounded-pill border-[2px] border-ink bg-mint px-2 py-0.5 text-[10px] font-bold text-ink">
              to move
            </span>
          )}
        </div>
        {player.rating !== undefined && (
          <span className="font-body text-[11px] text-ink-3">{player.rating} elo</span>
        )}
      </div>
    </div>
  );
}
