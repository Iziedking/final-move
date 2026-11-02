/**
 * Agent duels: one agent creates a duel and gets a code and a share link, and any
 * other agent joins with the code. It works the same over MCP, REST and WebSocket,
 * so a hand-written engine can face a frontier model.
 *
 * A pure duel tests the model rather than its tools: neither side gets a legal move
 * list, and both owners agree to give their agent no engines, code or other help.
 * The server can't see an owner's machine, so that part rests on the owner's word.
 */
import { randomBytes } from "node:crypto";
import { redis } from "../db/redis.ts";
import { sql } from "../db/client.ts";
import { cfg } from "../config/index.ts";
import { createGame, liveGames } from "../referee/game.ts";
import { startWorker } from "../chain/writer.ts";
import { getAgentWallet } from "./index.ts";

const TIME_CONTROLS = ["3+2", "5+3", "10+5"] as const;
const TTL_SEC = 900;
const CODE_RE = /^duel-[0-9a-f]{8}$/;

interface Duel {
  creatorId:   string;
  timeControl: (typeof TIME_CONTROLS)[number];
  pure:        boolean;
  gameId?:     string;
}

export class DuelError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 503 = 400) {
    super(message);
    this.name = "DuelError";
  }
}

export interface DuelStarted {
  gameId:      string;
  whiteId:     string;
  blackId:     string;
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

/** The live game this agent is playing, if any. One game at a time. */
export function activeGameFor(agentId: string): string | null {
  for (const g of liveGames.values()) {
    if ((g.whiteId === agentId || g.blackId === agentId) && (g.status === "live" || g.status === "waiting")) return g.id;
  }
  return null;
}

async function readDuel(code: string): Promise<Duel | null> {
  if (!CODE_RE.test(code)) return null;
  const raw = await redis.get(`duel:${code}`);
  return raw ? (JSON.parse(raw) as Duel) : null;
}

export async function createDuel(agentId: string, opts: { timeControl?: unknown; pure?: unknown }) {
  const timeControl = (opts.timeControl ?? "10+5") as Duel["timeControl"];
  if (!TIME_CONTROLS.includes(timeControl)) throw new DuelError("timeControl must be 3+2, 5+3 or 10+5");
  const pure = opts.pure !== false;
  const current = activeGameFor(agentId);
  if (current) throw new DuelError(`You are already in game ${current}. Finish or resign it first.`, 409);
  if (!(await getAgentWallet(agentId))) throw new DuelError("This agent has no wallet yet. Try again in a minute.", 503);

  const code = `duel-${randomBytes(4).toString("hex")}`;
  await redis.set(`duel:${code}`, JSON.stringify({ creatorId: agentId, timeControl, pure } satisfies Duel), "EX", TTL_SEC);
  return { code, link: duelLink(code), timeControl, pure, expiresInSec: TTL_SEC };
}

export async function joinDuel(agentId: string, code: string) {
  const duel = await readDuel(code);
  if (!duel) throw new DuelError("Unknown or expired duel code.", 404);
  if (duel.gameId) throw new DuelError("This duel has already started.", 409);
  if (duel.creatorId === agentId) throw new DuelError("You created this duel. Another agent has to join it.", 409);
  for (const id of [agentId, duel.creatorId]) {
    const current = activeGameFor(id);
    if (current) throw new DuelError(`${id === agentId ? "You are" : "The other agent is"} already in game ${current}.`, 409);
  }
  // Claim the code first, so two agents joining at once can't both start a game.
  const claimed = await redis.set(`duel-lock:${code}`, agentId, "EX", TTL_SEC, "NX");
  if (!claimed) throw new DuelError("Another agent is already joining this duel.", 409);

  try {
    const [mine, theirs] = await Promise.all([getAgentWallet(agentId), getAgentWallet(duel.creatorId)]);
    if (!mine || !theirs) throw new DuelError("Both agents need a wallet. Try again in a minute.", 503);
    const [base, inc] = duel.timeControl.split("+").map((n) => parseInt(n, 10));
    const baseSec = (base ?? 10) * 60;
    const incSec = inc ?? 5;
    const creatorWhite = Math.random() < 0.5;
    const w = creatorWhite ? { id: duel.creatorId, wallet: theirs } : { id: agentId, wallet: mine };
    const b = creatorWhite ? { id: agentId, wallet: mine } : { id: duel.creatorId, wallet: theirs };
    const game = await createGame({
      whiteId: w.id, whiteKind: "agent", whiteAddr: w.wallet.address, whiteWalletId: w.wallet.walletId,
      blackId: b.id, blackKind: "agent", blackAddr: b.wallet.address, blackWalletId: b.wallet.walletId,
      gameClass: "open", baseSec, incSec, timeControl: duel.timeControl,
      mode: duel.pure ? "pure" : "standard",
    });
    startWorker(mine.walletId);
    startWorker(theirs.walletId);
    await redis.set(`duel:${code}`, JSON.stringify({ ...duel, gameId: game.id } satisfies Duel), "EX", TTL_SEC);
    await onStarted?.({ gameId: game.id, whiteId: w.id, blackId: b.id, timeControl: duel.timeControl, baseSec, incSec })
      .catch((e: unknown) => console.error("[duel] start notify failed", (e as Error).message));
    return { gameId: game.id, color: w.id === agentId ? "w" as const : "b" as const, timeControl: duel.timeControl, pure: duel.pure };
  } catch (e) {
    await redis.del(`duel-lock:${code}`);
    throw e;
  }
}

/** For the creator: the game once someone has joined. */
export async function duelGameFor(code: string, agentId: string) {
  const duel = await readDuel(code);
  if (!duel || duel.creatorId !== agentId || !duel.gameId) return null;
  const game = liveGames.get(duel.gameId);
  const color = game ? (game.whiteId === agentId ? "w" : "b") : null;
  return { gameId: duel.gameId, color, pure: duel.pure, timeControl: duel.timeControl };
}

/** What the share page shows. No secrets, nothing that identifies an owner. */
export async function publicDuel(code: string) {
  const duel = await readDuel(code);
  if (!duel) return null;
  const rows = await sql<{ name: string; model_note: string | null }[]>`
    SELECT name, model_note FROM agents WHERE id=${duel.creatorId} LIMIT 1
  `;
  return {
    code,
    status:      duel.gameId ? "started" : "waiting",
    gameId:      duel.gameId ?? null,
    timeControl: duel.timeControl,
    pure:        duel.pure,
    creator:     { name: rows[0]?.name ?? "An agent", model: rows[0]?.model_note ?? null },
  };
}
