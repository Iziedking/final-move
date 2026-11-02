/**
 * Duels: one side creates a duel and gets a code and a share link, and anyone joins
 * with the code. Either side can be a person or an agent, and agents can use MCP,
 * REST or WebSocket, so a hand-written engine, a frontier model and a human can all
 * meet on one board.
 *
 * Open duels are listed in a public lobby, so people and agents can find each other
 * without swapping codes.
 *
 * A pure duel tests an agent's own reasoning: agents in it get no legal move list, and
 * owners agree to give their agent no engines or other help. The server can't see an
 * owner's machine, so that part rests on the owner's word.
 */
import { randomBytes } from "node:crypto";
import { redis } from "../db/redis.ts";
import { sql } from "../db/client.ts";
import { cfg } from "../config/index.ts";
import { createGame, liveGames } from "../referee/game.ts";
import { startWorker } from "../chain/writer.ts";
import { getAgentWallet } from "./index.ts";

export const TIME_CONTROLS = ["3+0", "3+2", "5+0", "5+3", "10+0", "10+5"] as const;
const TTL_SEC = 900;
const CODE_RE = /^duel-[0-9a-f]{8}$/;
const LOBBY = "duels:open";

export interface Side { id: string; kind: "agent" | "user" }

interface Duel {
  creatorId:   string;
  creatorKind: "agent" | "user";
  timeControl: (typeof TIME_CONTROLS)[number];
  pure:        boolean;
  open:        boolean;
  createdAt:   number;
  gameId?:     string;
}

export class DuelError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503 = 400) {
    super(message);
    this.name = "DuelError";
  }
}

export interface DuelStarted {
  gameId:      string;
  white:       Side;
  black:       Side;
  timeControl: string;
  baseSec:     number;
  incSec:      number;
}

/** index.ts tells WebSocket and REST agents that their game has started. */
let onStarted: ((info: DuelStarted) => Promise<void>) | null = null;
export function setDuelStartedHook(fn: (info: DuelStarted) => Promise<void>): void { onStarted = fn; }

export function duelLink(code: string): string {
  return `${cfg.PUBLIC_WEB_URL.replace(/\/$/, "")}/duel/${code}`;
}

/** The live game this player or agent is in, if any. One game at a time. */
export function activeGameFor(id: string): string | null {
  for (const g of liveGames.values()) {
    if ((g.whiteId === id || g.blackId === id) && (g.status === "live" || g.status === "waiting")) return g.id;
  }
  return null;
}

async function walletFor(side: Side): Promise<{ address: string; walletId: string } | null> {
  if (side.kind === "agent") return getAgentWallet(side.id);
  const rows = await sql<{ address: string; circle_wallet_id: string }[]>`
    SELECT address, circle_wallet_id FROM wallets WHERE owner_type='user' AND owner_id=${side.id} LIMIT 1
  `;
  return rows[0] ? { address: rows[0].address, walletId: rows[0].circle_wallet_id } : null;
}

async function nameOf(id: string, kind: "agent" | "user"): Promise<{ name: string; model: string | null }> {
  if (kind === "agent") {
    const rows = await sql<{ name: string; model_note: string | null }[]>`SELECT name, model_note FROM agents WHERE id=${id} LIMIT 1`;
    return { name: rows[0]?.name ?? "An agent", model: rows[0]?.model_note ?? null };
  }
  const rows = await sql<{ handle: string }[]>`SELECT handle FROM users WHERE id=${id} LIMIT 1`;
  return { name: rows[0] ? `@${rows[0].handle.replace(/^@/, "")}` : "A player", model: null };
}

async function readDuel(code: string): Promise<Duel | null> {
  if (!CODE_RE.test(code)) return null;
  const raw = await redis.get(`duel:${code}`);
  if (!raw) return null;
  const d = JSON.parse(raw) as Partial<Duel> & { creatorId: string };
  // Duels made before people could create them carry no kind or lobby fields.
  return { creatorKind: "agent", open: false, createdAt: 0, pure: true, timeControl: "10+5", ...d } as Duel;
}

const missingWallet = (side: Side) => new DuelError(
  side.kind === "agent" ? "This agent has no wallet yet. Try again in a minute." : "Your wallet isn't ready yet. Try again in a minute.",
  503,
);

export async function createDuel(side: Side, opts: { timeControl?: unknown; pure?: unknown; open?: unknown }) {
  const timeControl = (opts.timeControl ?? "10+5") as Duel["timeControl"];
  if (!TIME_CONTROLS.includes(timeControl)) throw new DuelError(`timeControl must be one of ${TIME_CONTROLS.join(", ")}`);
  const pure = opts.pure !== false;
  const open = opts.open !== false;
  const current = activeGameFor(side.id);
  if (current) throw new DuelError(`You are already in game ${current}. Finish or resign it first.`, 409);
  if (!(await walletFor(side))) throw missingWallet(side);

  const code = `duel-${randomBytes(4).toString("hex")}`;
  const duel: Duel = { creatorId: side.id, creatorKind: side.kind, timeControl, pure, open, createdAt: Date.now() };
  await redis.set(`duel:${code}`, JSON.stringify(duel), "EX", TTL_SEC);
  if (open) await redis.zadd(LOBBY, duel.createdAt, code);
  return { code, link: duelLink(code), timeControl, pure, open, expiresInSec: TTL_SEC };
}

export async function joinDuel(side: Side, code: string) {
  const duel = await readDuel(code);
  if (!duel) throw new DuelError("Unknown or expired duel code.", 404);
  if (duel.gameId) throw new DuelError("This duel has already started.", 409);
  if (duel.creatorId === side.id) throw new DuelError("You created this duel. Someone else has to join it.", 409);
  const creator: Side = { id: duel.creatorId, kind: duel.creatorKind };
  for (const s of [side, creator]) {
    const current = activeGameFor(s.id);
    if (current) throw new DuelError(`${s.id === side.id ? "You are" : "The other side is"} already in game ${current}.`, 409);
  }
  // Claim the code first, so two joiners at once can't both start a game.
  const claimed = await redis.set(`duel-lock:${code}`, side.id, "EX", TTL_SEC, "NX");
  if (!claimed) throw new DuelError("Someone else is already joining this duel.", 409);

  try {
    const [mine, theirs] = await Promise.all([walletFor(side), walletFor(creator)]);
    if (!mine) throw missingWallet(side);
    if (!theirs) throw new DuelError("The other side's wallet isn't ready yet. Try again in a minute.", 503);
    const [base, inc] = duel.timeControl.split("+").map((n) => parseInt(n, 10));
    const baseSec = (base ?? 10) * 60;
    const incSec = inc ?? 0;
    const creatorWhite = Math.random() < 0.5;
    const w = creatorWhite ? { side: creator, wallet: theirs } : { side, wallet: mine };
    const b = creatorWhite ? { side, wallet: mine } : { side: creator, wallet: theirs };
    const game = await createGame({
      whiteId: w.side.id, whiteKind: w.side.kind, whiteAddr: w.wallet.address, whiteWalletId: w.wallet.walletId,
      blackId: b.side.id, blackKind: b.side.kind, blackAddr: b.wallet.address, blackWalletId: b.wallet.walletId,
      gameClass: "open", baseSec, incSec, timeControl: duel.timeControl,
      mode: duel.pure ? "pure" : "standard",
    });
    startWorker(mine.walletId);
    startWorker(theirs.walletId);
    await redis.set(`duel:${code}`, JSON.stringify({ ...duel, gameId: game.id } satisfies Duel), "EX", TTL_SEC);
    await redis.zrem(LOBBY, code);
    await onStarted?.({ gameId: game.id, white: w.side, black: b.side, timeControl: duel.timeControl, baseSec, incSec })
      .catch((e: unknown) => console.error("[duel] start notify failed", (e as Error).message));
    return { gameId: game.id, color: w.side.id === side.id ? "w" as const : "b" as const, timeControl: duel.timeControl, pure: duel.pure };
  } catch (e) {
    await redis.del(`duel-lock:${code}`);
    throw e;
  }
}

/** For the creator: the game once someone has joined. */
export async function duelGameFor(code: string, id: string) {
  const duel = await readDuel(code);
  if (!duel || duel.creatorId !== id || !duel.gameId) return null;
  const game = liveGames.get(duel.gameId);
  const color = game ? (game.whiteId === id ? "w" : "b") : null;
  return { gameId: duel.gameId, color, pure: duel.pure, timeControl: duel.timeControl };
}

/** What the share page shows. No secrets, nothing beyond public names. */
export async function publicDuel(code: string) {
  const duel = await readDuel(code);
  if (!duel) return null;
  const who = await nameOf(duel.creatorId, duel.creatorKind);
  return {
    code,
    status:      duel.gameId ? "started" : "waiting",
    gameId:      duel.gameId ?? null,
    timeControl: duel.timeControl,
    pure:        duel.pure,
    creator:     { id: duel.creatorId, kind: duel.creatorKind, name: who.name, model: who.model },
  };
}

/** The public lobby: open duels still waiting for an opponent, newest first. */
export async function listOpenDuels(limit = 30) {
  const cutoff = Date.now() - TTL_SEC * 1000;
  await redis.zremrangebyscore(LOBBY, "-inf", cutoff);
  const codes = await redis.zrevrangebyscore(LOBBY, "+inf", cutoff, "LIMIT", 0, limit);
  const rows = await Promise.all(codes.map(async (code) => {
    const duel = await readDuel(code);
    if (!duel || duel.gameId) { await redis.zrem(LOBBY, code); return null; }
    const who = await nameOf(duel.creatorId, duel.creatorKind);
    return {
      code,
      link:        duelLink(code),
      timeControl: duel.timeControl,
      pure:        duel.pure,
      creator:     { kind: duel.creatorKind, name: who.name, model: who.model },
      waitingSec:  Math.round((Date.now() - duel.createdAt) / 1000),
    };
  }));
  return rows.filter((r): r is NonNullable<typeof r> => r !== null);
}
