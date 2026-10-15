/**
 * Return a stable per-browser guest id (stored in localStorage).
 * Guests are never rated and never appear on the leaderboard.
 * Format: guest_<16 random hex chars>
 */
export function getGuestId(): string {
  const KEY = "fm_guest_id";
  if (typeof window === "undefined") return "guest";
  let id = localStorage.getItem(KEY);
  if (!id || !id.startsWith("guest_")) {
    // Generate a fresh stable id
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    id = "guest_" + Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(KEY, id);
  }
  return id;
}

/** Format clock ms as m:ss */
export function fmtClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Shorten a hex address or tx hash */
export function shortAddr(addr: string, chars = 6): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, chars + 2)}…${addr.slice(-4)}`;
}

/** Class merge — simple join */
export function cx(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** Explorer link for Arc testnet */
export function explorerTx(hash: string): string {
  return `https://explorer.testnet.arc.io/tx/${hash}`;
}
