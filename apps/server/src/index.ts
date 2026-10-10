/**
 * Final Move server entry point.
 * HTTP: Hono on PORT (default 3001).
 * WebSocket: ws on the same port via Node http server.
 *   /ws        — browser clients (game UI)
 *   /v1/agent  — agent API (Stage 5)
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { legalMoves, moveToUci, toFEN } from "@final-move/chess";
import { sql } from "./db/client.ts";
import { cfg } from "./config/index.ts";
import { redis } from "./db/redis.ts";
import { startIndexer } from "./indexer/index.ts";
import { getHealth } from "./health/index.ts";
import { webhookRouter } from "./routes/webhook.ts";
import {
  createGame,
  handleMove,
  handleResign,
  getLiveGame,
} from "./referee/game.ts";
import { loadBots, getBot } from "./bots/index.ts";
import { startWorker } from "./chain/writer.ts";
import { getClocks } from "./referee/clocks.ts";
import type { ServerToAgent, AgentToServer } from "@final-move/shared";
import {
  enqueue,
  createChallenge,
  acceptChallenge,
  getRating,
} from "./matchmaking/index.ts";
import type { GameClass, TimeControl, QueueEntry } from "./matchmaking/index.ts";
import { getLeaderboard } from "./ratings/index.ts";

const app = new Hono();

// ── CORS (allow web app on any localhost port + PUBLIC_WEB_URL) ───────────────

app.use("*", cors({
  origin: (origin) => {
    if (!origin) return "*";
    if (origin.includes("localhost") || origin.includes("127.0.0.1")) return origin;
    if (cfg.PUBLIC_WEB_URL && origin === cfg.PUBLIC_WEB_URL) return origin;
    return null;
  },
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

// ── Health ─────────────────────────────────────────────────────────────────────

app.get("/health", async (c) => {
  const h = await getHealth();
  return c.json(h, h.ok ? 200 : 503);
});

// ── Webhook ────────────────────────────────────────────────────────────────────

app.route("/webhooks/circle", webhookRouter);

// ── Game REST API (browser + agents) ──────────────────────────────────────────

/** GET /v1/games/:id — current position + legal moves */
app.get("/v1/games/:id", (c) => {
  const id   = c.req.param("id");
  const game = getLiveGame(id);
  if (!game) return c.json({ error: "not_found" }, 404);
  const legal = legalMoves(game.position).map((m) => moveToUci(m));
  return c.json({
    gameId:   id,
    fen:      toFEN(game.position),
    moves:    game.moves,
    plyCount: game.plyCount,
    legalMoves: legal,
    status:   game.status,
    result:   game.result,
    reason:   game.reason,
  });
});

/** POST /v1/games — create a game vs a house bot */
app.post("/v1/games", async (c) => {
  const body = await c.req.json() as {
    opponentId:    string;   // e.g. "bot_1"
    timeControl:   string;   // "3+2" | "5+3" | "10+5"
    playerId:      string;   // user's id (or "guest")
    playerHandle:  string;
    playerAvatar?: string;
  };

  const bot = getBot(body.opponentId);
  if (!bot) return c.json({ error: "bot_not_found" }, 400);
  if (!bot.walletId || !bot.address) return c.json({ error: "bot_not_ready" }, 503);

  // Parse time control
  const tcParts = body.timeControl.split("+");
  const baseSec  = (parseInt(tcParts[0] ?? "3", 10)) * 60;
  const incSec   = parseInt(tcParts[1] ?? "2", 10);

  // Look up player wallet
  const isGuest = !body.playerId || body.playerId === "guest";
  let playerAddr   = "";
  let playerWallet = "";

  if (!isGuest) {
    const rows = await sql<{ address: string; circle_wallet_id: string }[]>`
      SELECT address, circle_wallet_id FROM wallets
      WHERE owner_type='user' AND owner_id=${body.playerId}
      LIMIT 1
    `;
    playerAddr   = rows[0]?.address           ?? "";
    playerWallet = rows[0]?.circle_wallet_id  ?? "";
  }

  if (!playerAddr) {
    // Guest or no wallet yet — referee relays their moves on-chain
    playerAddr   = cfg.REFEREE_WALLET_ADDRESS ?? bot.address; // fallback to bot addr for fen display only
    playerWallet = cfg.REFEREE_WALLET_ID;
  }

  // Randomly assign color
  const playerColor: "w" | "b" = Math.random() < 0.5 ? "w" : "b";
  const isWhite = playerColor === "w";

  const game = await createGame({
    whiteId:       isWhite ? body.playerId  : bot.id,
    whiteKind:     "user" as const,
    whiteAddr:     isWhite ? playerAddr     : bot.address,
    whiteWalletId: isWhite ? playerWallet   : bot.walletId,
    blackId:       isWhite ? bot.id         : body.playerId,
    blackKind:     "bot" as const,
    blackAddr:     isWhite ? bot.address    : playerAddr,
    blackWalletId: isWhite ? bot.walletId   : playerWallet,
    gameClass:    "open",
    baseSec,
    incSec,
    timeControl:  body.timeControl,
  });

  // Start per-wallet workers
  startWorker(playerWallet);
  startWorker(bot.walletId);

  // Kick off bot auto-play
  scheduleBot(game.id, bot.id, isWhite ? "b" : "w");

  return c.json({
    gameId:      game.id,
    playerId:    body.playerId,
    color:       playerColor,
    chainGameId: game.chainGameId,
  });
});

/** POST /v1/games/:id/move — REST move (fallback; WS preferred) */
app.post("/v1/games/:id/move", async (c) => {
  const id   = c.req.param("id");
  const body = await c.req.json() as { uci: string; playerId: string };
  const result = await handleMove(id, body.playerId, body.uci);
  return c.json(result, result.ok ? 200 : 400);
});

/** POST /v1/games/:id/resign */
app.post("/v1/games/:id/resign", async (c) => {
  const id   = c.req.param("id");
  const body = await c.req.json() as { playerId: string };
  const ok   = await handleResign(id, body.playerId);
  return c.json({ ok }, ok ? 200 : 400);
});

/** GET /v1/users/:id/rating */
app.get("/v1/users/:id/rating", async (c) => {
  const id  = c.req.param("id");
  const cls = (c.req.query("class") ?? "open") as GameClass;
  const tc  = (c.req.query("tc") ?? "3+2") as TimeControl;
  const r   = await getRating(id, cls, tc);
  return c.json({ subjectId: id, class: cls, tc, ...r, conservative: r.mu - 3 * r.sigma });
});

/** GET /v1/leaderboard */
app.get("/v1/leaderboard", async (c) => {
  const cls   = (c.req.query("class") ?? "open") as GameClass;
  const tc    = (c.req.query("tc") ?? "3+2") as TimeControl;
  const limit = Math.min(100, Number(c.req.query("limit") ?? 50));
  const rows  = await getLeaderboard(cls, tc, limit);
  return c.json({ class: cls, tc, rows });
});

/**
 * POST /v1/matchmaking/queue — join the matchmaking queue.
 * Returns immediately; the client polls GET /v1/matchmaking/queue/:ticketId
 * OR the server pushes a WS "matched" message.
 */
app.post("/v1/matchmaking/queue", async (c) => {
  const body = await c.req.json() as {
    playerId:    string;
    handle:      string;
    avatarUrl?:  string;
    gameClass:   GameClass;
    timeControl: TimeControl;
  };

  const ticketId = `ticket_${body.playerId}_${Date.now()}`;

  // Store a pending promise keyed by ticketId in Redis
  const ratingVal = await getRating(body.playerId, body.gameClass, body.timeControl);

  const entry: QueueEntry = {
    playerId:    body.playerId,
    handle:      body.handle,
    avatarUrl:   body.avatarUrl,
    gameClass:   body.gameClass,
    timeControl: body.timeControl,
    rating:      ratingVal,
    enqueuedAt:  Date.now(),
    resolve:     async (matchedId) => {
      if (matchedId) {
        await redis.set(`mm:${ticketId}`, JSON.stringify({ status: "matched", opponentId: matchedId }), "EX", 60);
      } else {
        await redis.set(`mm:${ticketId}`, JSON.stringify({ status: "no_match" }), "EX", 60);
      }
    },
  };

  enqueue(entry);
  await redis.set(`mm:${ticketId}`, JSON.stringify({ status: "queued" }), "EX", 60);
  return c.json({ ticketId });
});

/** GET /v1/matchmaking/queue/:ticketId — poll for match result */
app.get("/v1/matchmaking/queue/:id", async (c) => {
  const id  = c.req.param("id");
  const raw = await redis.get(`mm:${id}`);
  if (!raw) return c.json({ status: "expired" });
  return c.json(JSON.parse(raw));
});

/** DELETE /v1/matchmaking/queue/:ticketId — cancel queue entry */
app.delete("/v1/matchmaking/queue/:id", async (c) => {
  const id = c.req.param("id");
  await redis.del(`mm:${id}`);
  return c.json({ ok: true });
});

/** POST /v1/challenges — create a challenge link */
app.post("/v1/challenges", async (c) => {
  const body = await c.req.json() as {
    challengerId: string;
    gameClass:    GameClass;
    timeControl:  TimeControl;
  };
  const code = await createChallenge(body.challengerId, body.gameClass, body.timeControl);
  const url  = `${cfg.PUBLIC_WEB_URL ?? "http://localhost:3000"}/challenge/${code}`;
  return c.json({ code, url });
});

/** GET /v1/challenges/:code — look up a challenge */
app.get("/v1/challenges/:code", async (c) => {
  const challenge = await acceptChallenge(c.req.param("code"));
  if (!challenge) return c.json({ error: "not_found" }, 404);
  return c.json(challenge);
});

/** POST /v1/games/:id/draw-offer — offer or accept a draw */
app.post("/v1/games/:id/draw-offer", async (c) => {
  const gameId = c.req.param("id");
  const body   = await c.req.json() as { playerId: string };
  const game   = getLiveGame(gameId);
  if (!game || game.status !== "live") return c.json({ error: "game_not_live" }, 400);

  const key = `draw_offer:${gameId}`;
  const existing = await redis.get(key);

  if (!existing) {
    // First offer — set in Redis for 30s
    await redis.set(key, body.playerId, "EX", 30);
    roomBroadcast(gameId, { type: "draw_offered", gameId, byPlayerId: body.playerId });
    return c.json({ status: "offered" });
  }

  const offeredBy = existing;
  if (offeredBy === body.playerId) return c.json({ status: "already_offered" });

  // Accept — both sides agreed
  await redis.del(key);
  const { endGame } = await import("./referee/game.ts");
  await endGame(game, "draw", "agreement");
  return c.json({ status: "accepted" });
});

/** POST /v1/games/:id/rematch — offer or accept a rematch */
app.post("/v1/games/:id/rematch", async (c) => {
  const origGameId = c.req.param("id");
  const body = await c.req.json() as { playerId: string };

  const origRow = await sql<{
    white_id: string; white_kind: string; white_address: string; white_wallet_id: string;
    black_id: string; black_kind: string; black_address: string; black_wallet_id: string;
    class: string; time_control: string; base_sec: number; inc_sec: number; result: string;
  }[]>`
    SELECT white_id, white_kind, white_address, white_wallet_id,
           black_id, black_kind, black_address, black_wallet_id,
           class, time_control, base_sec, inc_sec, result
    FROM games WHERE id=${origGameId} AND status='ended'
    LIMIT 1
  `;
  if (!origRow[0]) return c.json({ error: "game_not_found" }, 404);
  const orig = origRow[0];

  // Check if offer exists
  const offerRow = await sql<{ offered_by: string }[]>`
    SELECT offered_by FROM rematch_offers
    WHERE game_id=${origGameId} AND accepted=false
      AND expires_at > now()
    LIMIT 1
  `;

  if (!offerRow[0]) {
    // Create offer
    await sql`
      INSERT INTO rematch_offers (game_id, offered_by)
      VALUES (${origGameId}, ${body.playerId})
      ON CONFLICT (game_id) DO UPDATE SET offered_by=${body.playerId}, expires_at=now()+interval '2 minutes', accepted=false
    `;
    roomBroadcast(origGameId, { type: "rematch_offered", gameId: origGameId, byPlayerId: body.playerId });
    return c.json({ status: "offered" });
  }

  if (offerRow[0].offered_by === body.playerId) return c.json({ status: "already_offered" });

  // Accept — swap colors for rematch
  await sql`UPDATE rematch_offers SET accepted=true WHERE game_id=${origGameId}`;

  const newGame = await createGame({
    whiteId:       orig.black_id,   // swap
    whiteKind:     orig.black_kind as "user" | "agent" | "bot",
    whiteAddr:     orig.black_address,
    whiteWalletId: orig.black_wallet_id,
    blackId:       orig.white_id,
    blackKind:     orig.white_kind as "user" | "agent" | "bot",
    blackAddr:     orig.white_address,
    blackWalletId: orig.white_wallet_id,
    gameClass:     orig.class as "open" | "human",
    baseSec:       orig.base_sec,
    incSec:        orig.inc_sec,
    timeControl:   orig.time_control,
  });

  startWorker(newGame.whiteWalletId);
  startWorker(newGame.blackWalletId);

  roomBroadcast(origGameId, { type: "rematch_created", gameId: origGameId, newGameId: newGame.id });
  return c.json({ status: "created", newGameId: newGame.id });
});

// ── Bot auto-play loop ─────────────────────────────────────────────────────────

async function scheduleBot(gameId: string, botId: string, botColor: "w" | "b") {
  const { getBotMove } = await import("./bots/index.ts");

  const play = async () => {
    const game = getLiveGame(gameId);
    if (!game || game.status === "ended" || game.status === "aborted") return;

    const turn = game.plyCount % 2 === 0 ? "w" : "b";
    if (turn !== botColor) {
      setTimeout(play, 500);
      return;
    }

    const uci = await getBotMove(botId, game.position);
    if (!uci) return;

    const result = await handleMove(gameId, botId, uci);
    if (!result.ok) return;

    if (!result.over) {
      setTimeout(play, 200);
    }
  };

  setTimeout(play, 300);
}

// ── Node HTTP server ──────────────────────────────────────────────────────────

const httpServer = createServer(async (req, res) => {
  const url  = `http://localhost${req.url}`;
  const hdrs: Record<string, string> = {};
  for (let i = 0; i < (req.rawHeaders?.length ?? 0); i += 2) {
    hdrs[req.rawHeaders[i]!.toLowerCase()] = req.rawHeaders[i + 1]!;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  await new Promise((r) => req.on("end", r));
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const fetchReq = new Request(url, {
    method: req.method,
    headers: hdrs,
    body: body?.length ? body : undefined,
  });
  const fetchRes = await app.fetch(fetchReq);
  res.writeHead(fetchRes.status, Object.fromEntries(fetchRes.headers.entries()));
  res.end(Buffer.from(await fetchRes.arrayBuffer()));
});

// ── WebSocket: browser clients (/ws) ─────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

// gameId → Map<playerId, WebSocket>
const gameRooms  = new Map<string, Map<string, WebSocket>>();
const playerGame = new Map<string, string>();

function roomBroadcast(gameId: string, msg: unknown) {
  const room = gameRooms.get(gameId);
  if (!room) return;
  const json = JSON.stringify(msg);
  for (const ws of room.values()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  }
}

type ChainRailState = "queued" | "sent" | "complete" | "final";

async function buildFullGameState(gameId: string) {
  const game = getLiveGame(gameId);
  if (!game) return null;

  const white = { id: game.whiteId, kind: game.whiteKind, handle: game.whiteId, color: "w" as const };
  const black = { id: game.blackId, kind: game.blackKind, handle: game.blackId, color: "b" as const };

  let clockWMs = 0, clockBMs = 0;
  try {
    const clocks = await getClocks(gameId);
    clockWMs = clocks.wMs;
    clockBMs = clocks.bMs;
  } catch {}

  let chainRail: unknown[] = [];
  try {
    const rows = await sql<{
      ply: number; uci: string; state: string;
      tx_hash: string | null; block: bigint | null;
      final_at: string | null; submitted_at: string | null;
    }[]>`
      SELECT ply, uci, state, tx_hash, block, final_at, submitted_at
      FROM moves WHERE game_id=${gameId} ORDER BY ply DESC
    `;
    chainRail = rows.map((r) => ({
      ply:    r.ply,
      san:    r.uci,
      state:  r.state as ChainRailState,
      txHash: r.tx_hash ?? undefined,
      block:  r.block ? Number(r.block) : undefined,
      finalMs: (r.final_at && r.submitted_at)
        ? new Date(r.final_at).getTime() - new Date(r.submitted_at).getTime()
        : undefined,
      explorerUrl: r.tx_hash ? `${cfg.ARC_EXPLORER}/tx/${r.tx_hash}` : undefined,
    }));
  } catch {}

  return {
    type:     "game_state",
    gameId,
    fen:      toFEN(game.position),
    turn:     (game.plyCount % 2 === 0 ? "w" : "b") as "w" | "b",
    plyCount: game.plyCount,
    moves:    game.moves,
    status:   game.status,
    result:   game.result,
    reason:   game.reason,
    white,
    black,
    clockWMs,
    clockBMs,
    chainRail,
  };
}

wss.on("connection", (ws) => {
  let myPlayerId = "";
  let myGameId   = "";

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as {
        type: string; gameId?: string; playerId?: string; uci?: string;
      };

      if (msg.type === "join" && msg.gameId && msg.playerId) {
        myGameId   = msg.gameId;
        myPlayerId = msg.playerId;

        if (!gameRooms.has(myGameId)) gameRooms.set(myGameId, new Map());
        gameRooms.get(myGameId)!.set(myPlayerId, ws);
        playerGame.set(myPlayerId, myGameId);

        const state = await buildFullGameState(myGameId);
        if (state && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(state));
        }
      }

      if (msg.type === "move" && msg.gameId && msg.uci && myPlayerId) {
        const result = await handleMove(msg.gameId, myPlayerId, msg.uci);
        if (!result.ok && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "move_rejected", reason: result.reason }));
        }
      }
    } catch (e) {
      console.error("[ws:browser] error:", (e as Error).message);
    }
  });

  ws.on("close", () => {
    if (myGameId && myPlayerId) {
      gameRooms.get(myGameId)?.delete(myPlayerId);
      playerGame.delete(myPlayerId);
    }
  });
});

// ── Redis pub/sub → broadcast to browser rooms + agent sockets ───────────────

const subscriber = redis.duplicate();
subscriber.psubscribe("game:*").catch((err: unknown) => {
  console.error("[redis:sub]", err);
});

subscriber.on("pmessage", (_pat: string, channel: string, message: string) => {
  const gameId = channel.replace("game:", "");
  try {
    roomBroadcast(gameId, JSON.parse(message));
  } catch {}
  // Forward to agent connections
  const game = getLiveGame(gameId);
  if (!game) return;
  for (const pid of [game.whiteId, game.blackId]) {
    const ws = agentConnections.get(pid);
    if (ws?.readyState === WebSocket.OPEN) ws.send(message);
  }
});

// ── WebSocket: agent API (/v1/agent) ──────────────────────────────────────────

const agentWss = new WebSocketServer({ server: httpServer, path: "/v1/agent" });
const agentConnections = new Map<string, WebSocket>();

agentWss.on("connection", (ws, req) => {
  const url     = new URL(req.url ?? "/", `http://localhost`);
  const agentId = url.searchParams.get("agentId") ?? "anon";
  agentConnections.set(agentId, ws);
  ws.send(JSON.stringify({ type: "hello", agentId, name: agentId } satisfies ServerToAgent));

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as AgentToServer;
      if (msg.type === "move") {
        const result = await handleMove(msg.gameId, agentId, msg.uci);
        if (!result.ok) ws.send(JSON.stringify({ type: "move_rejected", gameId: msg.gameId, reason: result.reason }));
      } else if (msg.type === "resign") {
        await handleResign(msg.gameId, agentId);
      }
    } catch (e) {
      console.error("[ws:agent] error:", (e as Error).message);
    }
  });
  ws.on("close", () => agentConnections.delete(agentId));
});

// ── Clock broadcast (1s tick) ─────────────────────────────────────────────────

setInterval(async () => {
  for (const [gameId, room] of gameRooms) {
    if (room.size === 0) continue;
    const game = getLiveGame(gameId);
    if (!game || game.status !== "live") continue;
    try {
      const clocks = await getClocks(gameId);
      roomBroadcast(gameId, { type: "clock", gameId, wMs: clocks.wMs, bMs: clocks.bMs });
    } catch {}
  }
}, 1_000);

// ── Startup ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[server] starting on port ${cfg.PORT}`);

  const { runMigrations } = await import("./db/migrate.ts");
  await runMigrations();

  startWorker(cfg.REFEREE_WALLET_ID);

  const bots = await loadBots();
  for (const bot of bots) {
    if (bot.walletId) startWorker(bot.walletId);
  }

  // Initialize indexer head to near chain tip if not already set
  {
    const { createPublicClient, http } = await import("viem");
    const rpc = createPublicClient({ transport: http(cfg.ARC_RPC_URL) });
    const head = await rpc.getBlockNumber().catch(() => 0n);
    const stored = await redis.get("indexer:head");
    if (!stored && head > 0n) {
      await redis.set("indexer:head", String(head - 50n));
      console.log(`[server] indexer head initialized to ${head - 50n}`);
    }
  }

  await startIndexer();

  httpServer.listen(cfg.PORT, () => {
    console.log(`[server] ready on :${cfg.PORT}`);
  });
}

main().catch((e) => {
  console.error("[server] fatal:", e);
  process.exit(1);
});
