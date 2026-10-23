/**
 * Game sounds with a mute switch that survives reloads. The sounds themselves
 * live in @final-move/ui (recordings in /public/audio/chess, synth fallback).
 */
import { playChessMove, playChessGameStart, playChessGameEnd, playWinnerChime } from "@final-move/ui";

const KEY = "fm_muted";
const listeners = new Set<(muted: boolean) => void>();

export function isMuted(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function setMuted(muted: boolean): void {
  try { localStorage.setItem(KEY, muted ? "1" : "0"); } catch { /* private mode */ }
  listeners.forEach((fn) => fn(muted));
}

export function onMutedChange(fn: (muted: boolean) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export const sfx = {
  move: (capture: boolean) => { if (!isMuted()) playChessMove(capture); },
  start: () => { if (!isMuted()) playChessGameStart(); },
  end: () => { if (!isMuted()) playChessGameEnd(); },
  win: () => { if (!isMuted()) playWinnerChime(); },
};
