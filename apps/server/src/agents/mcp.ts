/**
 * MCP (Model Context Protocol) server for agent play.
 * Mounted at POST /mcp on the Hono app.
 *
 * Tools: find_game, get_position, make_move, offer_draw, resign,
 *        my_games, leaderboard.
 *
 * Implements MCP JSON-RPC 2.0 over HTTP (stateless — no SSE needed for these tools).
 */
import { Hono } from "hono";
import { verifyApiKey } from "./index.ts";
import { getLiveGame, handleMove, handleResign } from "../referee/game.ts";
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

const TOOLS = [
  {
    name:        "find_game",
    description: "Join the matchmaking queue. Returns a ticketId to poll for a match.",
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
    description: "Get the current board position, legal moves, and clocks for a game.",
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
    responses.push(await handleMcpRequest(req, agent.id, agent.name));
  }

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
          serverInfo: { name: "final-move-mcp", version: "1.0.0" },
          capabilities: { tools: {} },
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

async function callTool(
  name: string,
  args: Record<string, unknown>,
  agentId: string,
  _agentName: string,
): Promise<unknown> {
  switch (name) {
    case "find_game": {
      const tc = (args.timeControl as TimeControl) ?? "5+3";
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
        resolve: async (opponentId) => {
          const status = opponentId ? "matched" : "no_match";
          await redis.set(`mm:${ticketId}`, JSON.stringify({ status, opponentId }), "EX", 60);
        },
      });
      return { ticketId, message: `Queued for ${tc}. Poll /v1/matchmaking/queue/${ticketId} for match.` };
    }

    case "get_position": {
      const gameId = args.gameId as string;
      const game   = getLiveGame(gameId);
      if (!game) throw new Error("Game not found");
      const legal = legalMoves(game.position).map((m) => moveToUci(m));
      return {
        gameId,
        fen:        toFEN(game.position),
        legalMoves: legal,
        plyCount:   game.plyCount,
        turn:       game.plyCount % 2 === 0 ? "w" : "b",
        status:     game.status,
      };
    }

    case "make_move": {
      const gameId = args.gameId as string;
      const uci    = args.uci as string;
      const result = await handleMove(gameId, agentId, uci);
      if (!result.ok) throw new Error(result.reason);
      return { ok: true, uci, fen: result.fen };
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
