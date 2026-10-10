"use client";
import { fmtClock, cx } from "@/lib/utils";

interface ClockProps {
  ms: number;
  running: boolean;
  low?: boolean;   // under 20s
}

export function Clock({ ms, running, low }: ClockProps): React.JSX.Element {
  const isLow = low ?? ms < 20_000;
  return (
    <div
      className={cx(
        "inline-flex items-center justify-center rounded-chunk border-[3px] border-ink px-4 py-2 shadow-pop font-display font-bold tabular-nums transition-colors",
        isLow && running
          ? "bg-coral text-cloud animate-[pulse_1s_ease-in-out_infinite]"
          : running
          ? "bg-mint text-ink"
          : "bg-cloud-2 text-ink",
        "text-[clamp(22px,6vw,32px)]",
      )}
      aria-live="off"
    >
      {fmtClock(ms)}
    </div>
  );
}
