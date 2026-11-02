/**
 * MCP (Model Context Protocol) server for agent play.
 * Mounted at POST /mcp on the Hono app.
 *
 * Tools: play_bot, create_duel, join_duel, check_duel, find_game, check_match,
 *        wait_for_turn, get_position, make_move, offer_draw, resign, my_games,
 *        leaderboard.
 *
 * The loop a coding agent runs: play_bot (or find_game), then wait_for_turn and
 * make_move until the game ends. wait_for_turn long-polls so the agent never spams.
 *
 * Implements MCP JSON-RPC 2.0 over HTTP (stateless — no SSE needed for these tools).
 */
import { Hono } from "hono";
import { verifyApiKey, getAgentWallet } from "./index.ts";
import { getLiveGame, handleMove, handleResign } from "../referee/game.ts";
import { activeGameFor, createDuel, joinDuel, duelGameFor } from "./duels.ts";
import { getClocks } from "../referee/clocks.ts";
import { legalMoves, moveToUci, toFEN } from "@final-move/chess";
import { sql } from "../db/client.ts";
import { redis } from "../db/redis.ts";
import { getLeaderboard } from "../ratings/index.ts";
import type { GameClass, TimeControl } from "../matchmaking/index.ts";

const PROTOCOL_VERSION = "2024-11-05";

interface McpRequest {
  jsonrpc: "2.0";
  id:      number | string | null;
  method:  string;
  params?: unknown;
}

interface McpResponse {
  jsonrpc: "2.0";
  id:      number | string | null;
  result?: unknown;
  error?:  { code: number; message: string };
}

const INSTRUCTIONS =
  "Final Move is live chess on Arc mainnet; every move is an onchain transaction. " +
  "To play: call play_bot (a house bot, always available) or find_game (other agents and people). " +
  "To play another agent, one side calls create_duel and shares the code; the other calls join_duel. " +
  "Then loop: wait_for_turn, pick one move, make_move, until status is ended. " +
  "In a pure duel you get no legal move list and must not use chess engines, code, websites or any other help: " +
  "choose every move by your own reasoning from the FEN. Illegal moves are rejected, counted and shown. " +
  "Moves are UCI, like e2e4 or e7e8q. Your clock runs while you think, and 60 seconds of silence " +
  "on your move loses by abandonment, so prefer 10+5 and keep thinking short.";

const BOT_IDS = ["bot_1", "bot_2", "bot_3", "bot_4", "bot_5"] as const;

/** Set by index.ts, which owns bot scheduling and game creation. */
type BotGameStarter = (opts: {
  agentId: string;
  wallet: { address: string; walletId: string };
  botId: string;
  timeControl: TimeControl;
}) => Promise<{ gameId: string; color: "w" | "b"; opponent: string }>;
let startBotGame: BotGameStarter | null = null;
export function setAgentBotGameStarter(fn: BotGameStarter): void { startBotGame = fn; }

const TOOLS = [
  {
    name:        "play_bot",
    description: "Start a game against a house bot right away. Levels 1 (Pawnderer, easiest) to 5 (GrandBot, strongest). Returns gameId and your color. Then call wait_for_turn.",
    inputSchema: {
      type: "object",
      properties: {
        level:       { type: "integer", minimum: 1, maximum: 5, description: "Bot strength, 1 to 5. Default 2." },
        timeControl: { type: "string", enum: ["3+2", "5+3", "10+5"], description: "Minutes + increment seconds. Default 10+5." },
      },
    },
  },
  {
    name:        "create_duel",
    description: "Challenge another agent: a model, a script or an engine, over MCP, REST or WebSocket. Returns a duel code and a share link; the other agent calls join_duel with the code. Waits up to 20 seconds for them. pure (default true) means no legal move list and no outside help for either side: moves come from the model's own reasoning.",
    inputSchema: {
      type: "object",
      properties: {
        timeControl: { type: "string", enum: ["3+2", "5+3", "10+5"], description: "Default 10+5." },
        pure:        { type: "boolean", description: "Pure reasoning duel. Default true." },
      },
    },
  },
  {
    name:        "join_duel",
    description: "Join a duel with the code another agent gave you. Returns the gameId and your color, then call wait_for_turn.",
    inputSchema: {
      type: "object",
      properties: { code: { type: "string" } },
      required: ["code"],
    },
  },
  {
    name:        "check_duel",
    description: "Check a duel you created. Returns the gameId once the other agent has joined.",
    inputSchema: {
      type: "object",
      properties: { code: { type: "string" } },
      required: ["code"],
    },
  },
  {
    name:        "check_match",
    description: "Check a find_game ticket. Returns matched with a gameId, still queued, or no_match.",
    inputSchema: {
      type: "object",
      properties: { ticketId: { type: "string" } },
      required: ["ticketId"],
    },
  },
  {
    name:        "wait_for_turn",
    description: "Wait until it is your move or the game ends (up to 25 seconds), then return the position: fen, legalMoves, clocks, last move and status. Call again if yourTurn is false and the game is still live.",
    inputSchema: {
      type: "object",
      properties: {
        gameId:      { type: "string" },
        timeoutSec:  { type: "integer", minimum: 1, maximum: 25 },
      },
      required: ["gameId"],
    },
  },
  {
    name:        "find_game",
    description: "Queue for a game against other agents or people. Waits up to 20 seconds and returns the gameId if matched, otherwise a ticketId for check_match. Nobody else may be queuing; play_bot always works.",
    inputSchema: {
      type: "object",
      properties: {
        timeControl: { type: "string", enum: ["3+2", "5+3", "10+5"] },
      },
      required: ["timeControl"],
    },
  },
  {
    name:        "get_position",
    description: "Get the current position right now: fen, legalMoves, your color, whose turn, clocks, last move and status.",
    inputSchema: {
      type: "object",
      properties: { gameId: { type: "string" } },
      required: ["gameId"],
    },
  },
  {
    name:        "make_move",
    description: "Play a move in UCI notation (e.g. e2e4, e7e8q).",
    inputSchema: {
      type: "object",
      properties: {
        gameId: { type: "string" },
        uci:    { type: "string" },
      },
      required: ["gameId", "uci"],
    },
  },
  {
    name:        "offer_draw",
    description: "Offer a draw or accept an existing draw offer.",
    inputSchema: {
      type: "object",
      properties: { gameId: { type: "string" } },
      required: ["gameId"],
    },
  },
  {
    name:        "resign",
    description: "Resign the current game.",
    inputSchema: {
      type: "object",
      properties: { gameId: { type: "string" } },
      required: ["gameId"],
    },
  },
  {
    name:        "my_games",
    description: "List your recent games and their results.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name:        "leaderboard",
    description: "Get the top players for a class (open/human).",
    inputSchema: {
      type: "object",
      properties: {
        class: { type: "string", enum: ["open", "human"] },
      },
    },
  },
];

export const mcpRouter = new Hono();

// ── MCP initialize ─────────────────────────────────────────────────────────────

mcpRouter.post("/", async (c) => {
  const authHeader = c.req.header("Authorization") ?? "";
  const key = authHeader.replace(/^Bearer\s+/i, "").trim();
  const agent = await verifyApiKey(key);
  if (!agent) {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, 401);
  }

  const body = await c.req.json() as McpRequest | McpRequest[];
  const requests = Array.isArray(body) ? body : [body];
  const responses: McpResponse[] = [];

  for (const req of requests) {
    // Notifications (like notifications/initialized) expect no reply.
    if (typeof req.method === "string" && req.method.startsWith("notifications/")) continue;
    responses.push(await handleMcpRequest(req, agent.id, agent.name));
  }

  if (responses.length === 0) return c.body(null, 202);
  return c.json(responses.length === 1 ? responses[0] : responses);
});

async function handleMcpRequest(
  req: McpRequest,
  agentId: string,
  agentName: string,
): Promise<McpResponse> {
  const id = req.id ?? null;

  try {
    if (req.method === "initialize") {
      return {
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: { name: "final-move-mcp", version: "1.1.0" },
          capabilities: { tools: {} },
          instructions: INSTRUCTIONS,
        },
      };
    }

    if (req.method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    }

    if (req.method === "tools/call") {
      const params = req.params as { name: string; arguments?: Record<string, unknown> };
      const args   = params.arguments ?? {};
      const result = await callTool(params.name, args, agentId, agentName);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } };
    }

    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  } catch (e) {
    return { jsonrpc: "2.0", id, error: { code: -32603, message: (e as Error).message } };
  }
}

async function illegalCount(gameId: string, agentId: string): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM illegal_attempts WHERE game_id=${gameId} AND player_id=${agentId}
  `.catch(() => [{ n: "0" }]);
  return Number(rows[0]?.n ?? 0);
}

/** Everything an agent needs to choose a move, or the final result once the game is over. */
async function positionFor(gameId: string, agentId: string) {
  const game = getLiveGame(gameId);
  if (!game) {
    const rows = await sql<{ white_id: string; black_id: string; status: string; result: string | null; reason: string | null }[]>`
      SELECT white_id, black_id, status, result, reason FROM games WHERE id=${gameId} LIMIT 1
    `;
    const r = rows[0];
    if (!r) throw new Error("Game not found");
    const yourColor = r.white_id === agentId ? "w" : r.black_id === agentId ? "b" : null;
    return { gameId, status: r.status, result: r.result, reason: r.reason, yourColor, yourTurn: false, legalMoves: [] as string[] };
  }
  const turn = game.plyCount % 2 === 0 ? "w" : "b";
  const yourColor = game.whiteId === agentId ? "w" : game.blackId === agentId ? "b" : null;
  const over = game.status === "ended" || game.status === "aborted";
  const clocks = await getClocks(game.id, game.baseSec).catch(() => null);
  const pure = game.mode === "pure";
  return {
    gameId,
    status:     game.status,
    mode:       pure ? "pure" : "standard",
    fen:        toFEN(game.position),
    yourColor,
    turn,
    yourTurn:   !over && turn === yourColor,
    // A pure duel tests the model's own reasoning, so it doesn't get the list.
    legalMoves: over || pure ? [] : legalMoves(game.position).map((m) => moveToUci(m)),
    yourIllegalAttempts: await illegalCount(gameId, agentId),
    lastMove:   game.moves[game.moves.length - 1] ?? null,
    plyCount:   game.plyCount,
    clocksMs:   clocks ? { w: clocks.wMs, b: clocks.bMs } : null,
    result:     game.result ?? null,
    reason:     game.reason ?? null,
  };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  agentId: string,
  _agentName: string,
): Promise<unknown> {
  switch (name) {
    case "play_bot": {
      if (!startBotGame) throw new Error("Bot games are not available right now.");
      const level = Number(args.level ?? 2);
      if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error("level must be 1 to 5");
      const tc = (args.timeControl as TimeControl) ?? "10+5";
      if (!["3+2", "5+3", "10+5"].includes(tc)) throw new Error("timeControl must be 3+2, 5+3 or 10+5");
      const current = activeGameFor(agentId);
      if (current) throw new Error(`You are already in game ${current}. Finish or resign it first.`);
      const wallet = await getAgentWallet(agentId);
      if (!wallet) throw new Error("This agent has no wallet yet. Try again in a minute.");
      const started = await startBotGame({ agentId, wallet, botId: BOT_IDS[level - 1]!, timeControl: tc });
      return {
        ...started,
        timeControl: tc,
        next: started.color === "w" ? "You are white and move first. Call wait_for_turn." : "You are black. Call wait_for_turn.",
      };
    }

    case "create_duel": {
      const duel = await createDuel(agentId, { timeControl: args.timeControl, pure: args.pure });
      const until = Date.now() + 20_000;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 500));
        const joined = await duelGameFor(duel.code, agentId);
        if (joined) return { ...duel, ...joined, next: "Your opponent joined. Call wait_for_turn." };
      }
      return {
        ...duel,
        next: `Share the code or the link with the other agent's owner; their agent joins with ${duel.code}. Then call check_duel with ${duel.code}. The code lasts 15 minutes.`,
      };
    }

    case "join_duel": {
      const joined = await joinDuel(agentId, String(args.code ?? "").trim());
      return {
        ...joined,
        next: joined.color === "w" ? "You are white and move first. Call wait_for_turn." : "You are black. Call wait_for_turn.",
      };
    }

    case "check_duel": {
      const code = String(args.code ?? "").trim();
      const joined = await duelGameFor(code, agentId);
      if (joined) return { code, ...joined, next: "Your opponent joined. Call wait_for_turn." };
      const raw = await redis.get(`duel:${code}`);
      if (!raw) return { code, status: "expired" };
      return { code, status: "waiting", next: "Not joined yet. Call check_duel again in a few seconds." };
    }

    case "check_match": {
      const ticketId = String(args.ticketId ?? "");
      if (!ticketId.startsWith(`ticket_${agentId}_`)) throw new Error("Unknown ticket");
      const raw = await redis.get(`mm:${ticketId}`);
      return raw ? JSON.parse(raw) as unknown : { status: "expired" };
    }

    case "wait_for_turn": {
      const gameId = String(args.gameId ?? "");
      const timeoutSec = Math.min(25, Math.max(1, Number(args.timeoutSec ?? 25)));
      const deadline = Date.now() + timeoutSec * 1000;
      for (;;) {
        const pos = await positionFor(gameId, agentId);
        const over = pos.status === "ended" || pos.status === "aborted";
        if (pos.yourTurn || over || Date.now() >= deadline) {
          return over || pos.yourTurn ? pos : { ...pos, note: "Not your turn yet. Call wait_for_turn again." };
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    case "find_game": {
      const tc = (args.timeControl as TimeControl) ?? "5+3";
      const current = activeGameFor(agentId);
      if (current) throw new Error(`You are already in game ${current}. Finish or resign it first.`);
      const wallet = await getAgentWallet(agentId);
      if (!wallet) throw new Error("This agent has no wallet yet. Try again in a minute.");
      const ticketId = `ticket_${agentId}_${Date.now()}`;
      await redis.set(`mm:${ticketId}`, JSON.stringify({ status: "queued" }), "EX", 60);
      // Enqueue via in-process matchmaking
      const { enqueue, getRating } = await import("../matchmaking/index.ts");
      const rating = await getRating(agentId, "open", tc);
      enqueue({
        playerId:    agentId,
        handle:      agentId,
        gameClass:   "open",
        timeControl: tc,
        rating,
        enqueuedAt:  Date.now(),
        walletId:    wallet.walletId,
        address:     wallet.address,
        kind:        "agent" as const,
        resolve: async (opponent, gameId) => {
          const status = opponent ? (gameId ? "matched" : "error") : "no_match";
          await redis.set(`mm:${ticketId}`, JSON.stringify({ status, gameId: gameId ?? undefined, opponentId: opponent?.playerId }), "EX", 60);
        },
      });
      // Wait briefly so the common case needs one call. Matchmaking gives up after 30 s.
      const until = Date.now() + 20_000;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 500));
        const raw = await redis.get(`mm:${ticketId}`);
        const state = raw ? JSON.parse(raw) as { status: string; gameId?: string } : null;
        if (state && state.status !== "queued") {
          return state.status === "matched"
            ? { ...state, next: "Call wait_for_turn with this gameId." }
            : { ...state, next: "No opponent found. Try play_bot." };
        }
      }
      return { ticketId, status: "queued", next: "Still waiting. Call check_match with this ticketId, or play_bot instead." };
    }

    case "get_position": {
      return positionFor(String(args.gameId ?? ""), agentId);
    }

    case "make_move": {
      const gameId = args.gameId as string;
      const uci    = args.uci as string;
      const before = getLiveGame(gameId);
      const result = await handleMove(gameId, agentId, uci);
      if (!result.ok) {
        if (result.reason === "illegal" && before) {
          await sql`
            INSERT INTO illegal_attempts (game_id, player_id, ply, uci)
            VALUES (${gameId}, ${agentId}, ${before.plyCount + 1}, ${String(uci).slice(0, 10)})
          `.catch(() => {});
          throw new Error(`Illegal move ${uci}. The position is unchanged and your clock is still running. It is recorded as an illegal attempt.`);
        }
        throw new Error(result.reason);
      }
      return { ok: true, uci, fen: result.fen, next: result.over ? "The game is over." : "Call wait_for_turn." };
    }

    case "offer_draw": {
      const gameId = args.gameId as string;
      const key    = `draw_offer:${gameId}`;
      const existing = await redis.get(key);
      if (!existing) {
        await redis.set(key, agentId, "EX", 30);
        return { status: "offered" };
      }
      if (existing === agentId) return { status: "already_offered" };
      // Accept
      await redis.del(key);
      const { endGame } = await import("../referee/game.ts");
      const game = getLiveGame(gameId);
      if (game) await endGame(game, "draw", "agreement");
      return { status: "accepted" };
    }

    case "resign": {
      const gameId = args.gameId as string;
      await handleResign(gameId, agentId);
      return { ok: true };
    }

    case "my_games": {
      const rows = await sql<{
        id: string; white_id: string; black_id: string;
        status: string; result: string | null; time_control: string; ended_at: Date | null;
      }[]>`
        SELECT id, white_id, black_id, status, result, time_control, ended_at
        FROM games
        WHERE (white_id=${agentId} OR black_id=${agentId})
        ORDER BY created_at DESC
        LIMIT 10
      `;
      return rows.map((r) => ({
        gameId:      r.id,
        color:       r.white_id === agentId ? "w" : "b",
        opponent:    r.white_id === agentId ? r.black_id : r.white_id,
        status:      r.status,
        result:      r.result,
        timeControl: r.time_control,
        endedAt:     r.ended_at,
      }));
    }

    case "leaderboard": {
      const cls = ((args.class as string) ?? "open") as GameClass;
      const tc  = ((args.timeControl as string) ?? "5+3") as TimeControl;
      return getLeaderboard(cls, tc, 20);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
