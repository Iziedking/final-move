import type React from "react";
import Image from "next/image";
import type { PlayerInfo } from "@/lib/types";
import { BotAvatar } from "@/components/BotAvatar";

interface PlayerBarProps {
  player: PlayerInfo;
  /** This side is to move. */
  active: boolean;
  /** This bar is the viewer. */
  isMe?: boolean;
  /** Material lead in pawns (positive only); omitted when level. */
  lead?: number;
}

const KIND: Record<PlayerInfo["kind"], { label: string; bg: string } | null> = {
  user: null,
  bot: { label: "Bot", bg: "var(--cyan)" },
  agent: { label: "Agent", bg: "var(--amber)" },
};

export function PlayerBar({ player, active, isMe = false, lead }: PlayerBarProps): React.JSX.Element {
  const kind = KIND[player.kind];
  return (
    <div
      className="flex min-w-0 items-center gap-3 px-3 py-2 transition-[transform,box-shadow] duration-200"
      style={{
        background: "rgb(var(--cloud))",
        border: "var(--line) solid rgb(var(--ink))",
        borderRadius: "var(--r)",
        boxShadow: active ? "4px 4px 0 rgb(var(--pop-shadow))" : "2px 2px 0 rgb(var(--pop-shadow))",
        transform: active ? "translate(-1px, -1px)" : undefined,
      }}
    >
      <div
        className="relative h-10 w-10 shrink-0 overflow-hidden"
        style={{ border: "2.5px solid rgb(var(--ink))", borderRadius: "12px", background: "rgb(var(--sky-2))" }}
      >
        {player.avatar ? (
          <Image src={player.avatar} alt="" fill className="object-cover" sizes="40px" />
        ) : player.kind === "bot" || player.kind === "agent" ? (
          <BotAvatar className="h-full w-full p-0.5" botId={player.id} />
        ) : (
          <span className="grid h-full w-full place-items-center font-display text-base font-extrabold" style={{ color: "rgb(var(--ink))" }}>
            {player.handle[0]?.toUpperCase() ?? "?"}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="h-3.5 w-3.5 shrink-0 rounded-full"
            style={{ background: player.color === "w" ? "#fff" : "rgb(var(--piece-black))", border: "2px solid rgb(var(--piece-line))" }}
            aria-label={player.color === "w" ? "plays white" : "plays black"}
            role="img"
          />
          <span className="truncate font-display text-[17px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>
            {player.handle}
          </span>
          {isMe && <span className="chip shrink-0 py-0 text-[10px]" style={{ background: "rgb(var(--violet))", color: "#fff" }}>You</span>}
          {kind && <span className="chip shrink-0 py-0 text-[10px]" style={{ background: `rgb(${kind.bg})`, color: "rgb(var(--candy-ink))" }}>{kind.label}</span>}
        </div>
        <div className="flex items-center gap-2 text-[12px] font-bold leading-tight" style={{ color: "rgb(var(--ink-3))" }}>
          {player.rating !== undefined && <span className="tabular-nums">{Math.round(player.rating)}</span>}
          {lead !== undefined && lead > 0 && <span className="tabular-nums" style={{ color: "rgb(var(--ink-2))" }}>+{lead}</span>}
          {active && <span style={{ color: "rgb(var(--violet))" }}>{isMe ? "Your move" : "Thinking…"}</span>}
        </div>
      </div>
    </div>
  );
}
