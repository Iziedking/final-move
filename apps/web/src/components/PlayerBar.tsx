import type React from "react";
import type { PlayerInfo } from "@/lib/types";
import Image from "next/image";
import { BotAvatar } from "@/components/BotAvatar";

interface PlayerBarProps {
  player: PlayerInfo;
  active: boolean;
}

export function PlayerBar({ player, active }: PlayerBarProps): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl px-3 py-2 border-2 transition-colors"
      style={{
        background:   active ? "rgb(var(--teal-light))" : "rgb(var(--cloud))",
        borderColor:  active ? "rgb(var(--teal))"       : "rgb(var(--ink) / 0.15)",
        boxShadow:    active ? "3px 3px 0 rgb(var(--teal-light))" : "none",
      }}
    >
      {/* Avatar */}
      <div
        className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-xl border-2"
        style={{ borderColor: "rgb(var(--ink))", background: "rgb(var(--sky-2))" }}
      >
        {player.avatar ? (
          <Image src={player.avatar} alt={player.handle} fill className="object-cover" sizes="36px" />
        ) : player.kind === "bot" ? (
          <BotAvatar className="w-full h-full p-0.5" />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center text-sm font-bold font-display"
            style={{ color: "rgb(var(--ink))" }}
          >
            {player.handle[0]?.toUpperCase() ?? "?"}
          </span>
        )}
      </div>

      {/* Name + rating */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="truncate text-sm font-bold font-display" style={{ color: "rgb(var(--ink))" }}>
            {player.handle}
          </span>
          <span
            className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border-2 text-[9px] font-bold"
            style={{
              background:  player.color === "w" ? "#fff" : "rgb(var(--ink))",
              borderColor: "rgb(var(--ink))",
              color:       player.color === "w" ? "rgb(var(--ink))" : "#fff",
            }}
            aria-label={player.color === "w" ? "white" : "black"}
          >
            {player.color === "w" ? "W" : "B"}
          </span>
          {active && (
            <span className="chip" style={{ background: "rgb(var(--teal))", color: "#fff", borderColor: "rgb(var(--ink))" }}>
              to move
            </span>
          )}
        </div>
        {player.rating !== undefined && (
          <span className="text-[11px] tabular-nums font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
            {player.rating} elo
          </span>
        )}
      </div>
    </div>
  );
}
