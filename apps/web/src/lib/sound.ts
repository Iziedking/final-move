/**
 * Game sounds with a mute switch that survives reloads.
 *
 * The sounds are our own, rendered by brand/build_sounds.py into /public/audio/game. They play
 * through Web Audio rather than <audio> elements, because a move sound has to land the moment
 * the piece does and overlapping sounds must not cut each other off. Every failure is silent:
 * a sound problem must never affect the game.
 */

const KEY = "fm_muted";
const listeners = new Set<(muted: boolean) => void>();

export function isMuted(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function setMuted(muted: boolean): void {
  try { localStorage.setItem(KEY, muted ? "1" : "0"); } catch { /* private mode */ }
  if (!muted) { unlock(); play("move"); } // let them hear that sound is back on
  listeners.forEach((fn) => fn(muted));
}

export function onMutedChange(fn: (muted: boolean) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const NAMES = ["move", "capture", "castle", "check", "promote", "illegal", "start", "win", "lose", "draw", "low-time", "notify"] as const;
type SoundName = (typeof NAMES)[number];

const MASTER_VOLUME = 0.85;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let loading = false;
let startWanted = false;
const buffers = new Map<SoundName, AudioBuffer>();

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!ctx) {
      ctx = new Ctx();
      master = ctx.createGain();
      master.gain.value = MASTER_VOLUME;
      master.connect(ctx.destination);
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Browsers keep audio suspended until a user gesture, so resume on every chance we get. */
function unlock(): void {
  const c = context();
  if (c?.state === "suspended") void c.resume().catch(() => {});
}

/** Fetch and decode the set. Call on the game screen; safe to call more than once. */
export function preloadSounds(): void {
  const c = context();
  if (!c || loading) return;
  loading = true;
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
  for (const name of NAMES) {
    void fetch(`/audio/game/${name}.wav`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((data) => c.decodeAudioData(data))
      .then((buffer) => {
        buffers.set(name, buffer);
        if (name === "start" && startWanted) { startWanted = false; play("start"); }
      })
      .catch(() => { /* that one sound stays silent */ });
  }
}

function play(name: SoundName, opts: { delay?: number; rate?: number; volume?: number } = {}): void {
  if (isMuted()) return;
  const c = context();
  const buffer = buffers.get(name);
  if (!c || !master || !buffer) return;
  unlock();
  // A suspended context would hold every sound and fire them all at once on the first tap.
  if (c.state !== "running") return;
  try {
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = opts.rate ?? 1;
    const gain = c.createGain();
    gain.gain.value = opts.volume ?? 1;
    src.connect(gain).connect(master);
    src.start(c.currentTime + (opts.delay ?? 0));
  } catch { /* ignore */ }
}

/** Pieces vary slightly, so a long game doesn't sound like one sample on repeat. */
const humanize = (base: number) => base * (0.975 + Math.random() * 0.05);

export const sfx = {
  /**
   * The sound for one move, read from its SAN. An opponent's move sits a little lower than
   * your own, so you can hear whose move landed without looking.
   */
  move(san: string, mine: boolean): void {
    const rate = humanize(mine ? 1 : 0.92);
    if (san.includes("=")) play("promote");
    else if (san.startsWith("O-O")) play("castle", { rate });
    else if (san.includes("x")) play("capture", { rate });
    else play("move", { rate });
    if (san.includes("+")) play("check", { delay: 0.07 });
  },
  start: () => { if (buffers.has("start")) play("start"); else startWanted = true; },
  win: () => play("win"),
  lose: () => play("lose"),
  draw: () => play("draw"),
  illegal: () => play("illegal"),
  lowTime: () => play("low-time"),
  notify: () => play("notify"),
};
