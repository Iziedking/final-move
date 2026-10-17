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
import {
  registerAgent,
  verifyApiKey,
  listAgents,
  getAgentWallet,
} from "./agents/index.ts";
import { mcpRouter } from "./agents/mcp.ts";
import { pushEvent, waitForEvent } from "./agents/events.ts";
import {
  createTournament,
  fundTournament,
  registerEntry,
  startTournament,
  getTournament,
  listTournaments,
  getTournamentEntries,
  getTournamentGames,
} from "./tournaments/index.ts";
import {
  createStakeOffer,
  openStakeOnChain,
  playerApproveAndDeposit,
  settleMatch,
  cancelUnfunded,
  refundAfterTimeout,
  getStakeOffer,
} from "./stakes/index.ts";

const app = new Hono();

// ── CORS — exact allowlist (no substring match) ───────────────────────────────
// SECURITY: origin.includes("localhost") previously matched "localhost.evil.com".
// Now only exact matches are allowed.
const allowedOrigins = new Set<string>(
  [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:5173",
    cfg.PUBLIC_WEB_URL,
  ].filter(Boolean),
);

app.use("*", cors({
  origin: (origin): string | null => {
    if (!origin) return null;
    if (allowedOrigins.has(origin)) return origin;
    return null;
  },
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Internal-Secret"],
  credentials: true,
}));

// ── Body size cap (~64 KB for JSON routes) ────────────────────────────────────
app.use("*", async (c, next): Promise<Response | void> => {
  const cl = parseInt(c.req.header("content-length") ?? "0");
  if (cl > 65_536) return c.json({ error: "payload_too_large" }, 413);
  await next();
});

// ── Rate limiting (per-IP: 120 req/60s; per-identity: 60 req/60s) ─────────────
app.use("*", ipRateLimit());

import { requirePlayer, requireAdmin, requireInternal } from "./auth/middleware.ts";
import { mintToken, verifyToken, tokenFromHeader } from "./auth/tokens.ts";
import { ipRateLimit } from "./util/rate.ts";

// ── Session token endpoint ─────────────────────────────────────────────────────
// GET /v1/session — returns (or refreshes) a short-lived signed player token.
// The Next.js web app calls this after NextAuth resolves the session and sends
// the result as X-Internal-Secret to prove it is a trusted server-to-server call.
// Guests (no session) get a server-issued guest token with a server-chosen id.

app.post("/v1/session", async (c) => {
  // Accepts two modes:
  //   1. Internal (web server → API server): X-Internal-Secret header + body { userId, handle, avatar }
  //   2. Guest: no secret, no body → issues a guest token
  const internalSecret = c.req.header("X-Internal-Secret");
  const isInternal = cfg.INTERNAL_SECRET
    ? internalSecret === cfg.INTERNAL_SECRET
    : false;

  if (isInternal) {
    const body = await c.req.json().catch(() => ({})) as {
      userId?: string; handle?: string; avatar?: string;
    };
    if (!body.userId) return c.json({ error: "userId required" }, 400);
    const token = mintToken(body.userId, "user", 3600);
    return c.json({ token, playerId: body.userId, type: "user" });
  }

  // Guest path — generate a stable guest id from cookie or create a new one
  const existingToken = tokenFromHeader(c.req.header("Authorization") ?? "");
  if (existingToken) {
    const existing = verifyToken(existingToken);
    if (existing?.type === "guest") {
      // Refresh the guest token (extend TTL)
      const refreshed = mintToken(existing.sub, "guest", 7200);
      return c.json({ token: refreshed, playerId: existing.sub, type: "guest" });
    }
  }

  // Brand new guest
  const guestId = "guest_" + Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString("hex");
  const token = mintToken(guestId, "guest", 7200);
  return c.json({ token, playerId: guestId, type: "guest" });
});

// ── Health ─────────────────────────────────────────────────────────────────────
// Public: liveness only (ok, lag). Treasury/top-up detail requires admin token.

app.get("/health", async (c) => {
  const h = await getHealth();
  const isAdmin = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim() === cfg.ADMIN_TOKEN && !!cfg.ADMIN_TOKEN;
  if (!isAdmin) {
    // Public liveness — strip sensitive detail
    return c.json({ ok: h.ok, lag: (h as Record<string, unknown>).lag }, h.ok ? 200 : 503);
  }
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
  // Identity from token (guest token is ok — playerId derived from it)
  const caller = requirePlayer(c); if (!caller) return c.res;
  const body = await c.req.json() as {
    opponentId:    string;   // e.g. "bot_1"
    timeControl:   string;   // "3+2" | "5+3" | "10+5"
    playerHandle:  string;
    playerAvatar?: string;
  };
  // Validate time control
  const validTcs = ["3+2", "5+3", "10+5"];
  if (!validTcs.includes(body.timeControl))
    return c.json({ error: "invalid_time_control" }, 400);

  await loadBots(); // ensure cache populated (no-op after first call)
  const bot = getBot(body.opponentId);
  if (!bot) return c.json({ error: "bot_not_found" }, 400);
  if (!bot.walletId || !bot.address) return c.json({ error: "bot_not_ready" }, 503);

  // Parse time control
  const tcParts = body.timeControl.split("+");
  const baseSec  = (parseInt(tcParts[0] ?? "3", 10)) * 60;
  const incSec   = parseInt(tcParts[1] ?? "2", 10);

  const playerId = caller.sub; // always token-derived
  const isGuest  = caller.type === "guest";

  // Look up player wallet
  let playerAddr   = "";
  let playerWallet = "";

  if (!isGuest) {
    const rows = await sql<{ address: string; circle_wallet_id: string }[]>`
      SELECT address, circle_wallet_id FROM wallets
      WHERE owner_type='user' AND owner_id=${playerId}
      LIMIT 1
    `;
    playerAddr   = rows[0]?.address           ?? "";
    playerWallet = rows[0]?.circle_wallet_id  ?? "";
  }

  if (!playerAddr) {
    // Guest or no wallet yet — referee relays their moves on-chain
    playerAddr   = cfg.REFEREE_WALLET_ADDRESS ?? bot.address;
    playerWallet = cfg.REFEREE_WALLET_ID;
  }

  // Randomly assign color
  const playerColor: "w" | "b" = Math.random() < 0.5 ? "w" : "b";
  const isWhite = playerColor === "w";

  const humanKind = "user" as const;
  const botKind   = "bot" as const;

  const game = await createGame({
    whiteId:       isWhite ? playerId  : bot.id,
    whiteKind:     isWhite ? humanKind : botKind,
    whiteAddr:     isWhite ? playerAddr     : bot.address,
    whiteWalletId: isWhite ? playerWallet   : bot.walletId,
    blackId:       isWhite ? bot.id         : playerId,
    blackKind:     isWhite ? botKind        : humanKind,
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
    playerId,
    color:       playerColor,
    chainGameId: game.chainGameId,
  });
});

/** POST /v1/games/bot-vs-bot — admin only */
app.post("/v1/games/bot-vs-bot", async (c) => {
  if (!requireAdmin(c)) return c.res;
  const body = await c.req.json() as {
    whiteId: string; blackId: string; timeControl: string;
  };
  const bots = await loadBots();
  const white = bots.find((b) => b.id === body.whiteId);
  const black = bots.find((b) => b.id === body.blackId);
  if (!white) return c.json({ error: "white_bot_not_found" }, 400);
  if (!black) return c.json({ error: "black_bot_not_found" }, 400);

  const tcParts = body.timeControl.split("+");
  const baseSec = parseInt(tcParts[0] ?? "3", 10) * 60;
  const incSec  = parseInt(tcParts[1] ?? "2", 10);

  const game = await createGame({
    whiteId: white.id, whiteKind: "bot", whiteAddr: white.address, whiteWalletId: white.walletId,
    blackId: black.id, blackKind: "bot", blackAddr: black.address, blackWalletId: black.walletId,
    gameClass: "open", baseSec, incSec, timeControl: body.timeControl,
  });

  startWorker(white.walletId);
  startWorker(black.walletId);
  scheduleBot(game.id, white.id, "w");
  scheduleBot(game.id, black.id, "b");

  return c.json({ gameId: game.id, chainGameId: game.chainGameId });
});

/** POST /v1/games/:id/move — REST move (fallback; WS preferred) */
app.post("/v1/games/:id/move", async (c) => {
  const caller = requirePlayer(c); if (!caller) return c.res;
  const id   = c.req.param("id");
  const body = await c.req.json() as { uci: string };
  // Verify caller is a player in this game
  const game = getLiveGame(id);
  if (!game) return c.json({ error: "not_found" }, 404);
  if (caller.sub !== game.whiteId && caller.sub !== game.blackId)
    return c.json({ error: "not_a_player" }, 403);
  const result = await handleMove(id, caller.sub, body.uci);
  return c.json(result, result.ok ? 200 : 400);
});

/** POST /v1/games/:id/resign */
app.post("/v1/games/:id/resign", async (c) => {
  const caller = requirePlayer(c); if (!caller) return c.res;
  const id   = c.req.param("id");
  const game = getLiveGame(id);
  if (!game) return c.json({ error: "not_found" }, 404);
  if (caller.sub !== game.whiteId && caller.sub !== game.blackId)
    return c.json({ error: "not_a_player" }, 403);
  const ok   = await handleResign(id, caller.sub);
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
  const caller = requirePlayer(c); if (!caller) return c.res;
  const body = await c.req.json() as {
    handle:      string;
    avatarUrl?:  string;
    gameClass:   GameClass;
    timeControl: TimeControl;
  };
  const playerId = caller.sub;

  // Validate time control
  const validTcs: TimeControl[] = ["3+2", "5+3", "10+5"];
  if (!validTcs.includes(body.timeControl as TimeControl))
    return c.json({ error: "invalid_time_control" }, 400);

  // Resolve caller's wallet + address
  const walletRow = await sql<{ circle_wallet_id: string; address: string }[]>`
    SELECT circle_wallet_id, address FROM wallets
    WHERE owner_type='user' AND owner_id=${playerId} LIMIT 1
  `;
  if (!walletRow[0]) return c.json({ error: "no_wallet" }, 400);
  const { circle_wallet_id: walletId, address } = walletRow[0];

  const ticketId = `ticket_${playerId}_${Date.now()}`;
  const ratingVal = await getRating(playerId, body.gameClass, body.timeControl);

  const entry: QueueEntry = {
    playerId,
    handle:      body.handle,
    avatarUrl:   body.avatarUrl,
    gameClass:   body.gameClass,
    timeControl: body.timeControl,
    rating:      ratingVal,
    enqueuedAt:  Date.now(),
    walletId,
    address,
    kind:        "user",
    resolve: async (opponent) => {
      if (!opponent) {
        // No match — indicate bot fallback available
        await redis.set(`mm:${ticketId}`, JSON.stringify({ status: "no_match" }), "EX", 60);
        return;
      }
      // Both sides present — create the game (white = lower ticketId alphabetically for determinism)
      const [white, black] = playerId < opponent.playerId ? [entry, opponent] : [opponent, entry];
      try {
        const [baseSec, incSec] = body.timeControl.split("+").map(Number).map((n, i) => i === 0 ? n * 60 : n);
        const game = await createGame({
          whiteId: white.playerId, whiteKind: white.kind,
          whiteAddr: white.address, whiteWalletId: white.walletId,
          blackId: black.playerId, blackKind: black.kind,
          blackAddr: black.address, blackWalletId: black.walletId,
          gameClass: body.gameClass,
          baseSec: baseSec!, incSec: incSec!,
          timeControl: body.timeControl,
        });
        startWorker(white.walletId);
        startWorker(black.walletId);
        await redis.set(`mm:${ticketId}`, JSON.stringify({ status: "matched", gameId: game.id, opponentId: opponent.playerId }), "EX", 120);
        // Also notify the opponent's ticket if we can find it
        const oppTicketKey = `mm:ticket:${opponent.playerId}`;
        const oppTicketId = await redis.get(oppTicketKey);
        if (oppTicketId) {
          await redis.set(`mm:${oppTicketId}`, JSON.stringify({ status: "matched", gameId: game.id, opponentId: playerId }), "EX", 120);
        }
      } catch (e) {
        console.error("[matchmaking] createGame failed:", (e as Error).message);
        await redis.set(`mm:${ticketId}`, JSON.stringify({ status: "error" }), "EX", 60);
      }
    },
  };

  // Store ticketId keyed by playerId so the opponent's resolve can find it
  await redis.set(`mm:ticket:${playerId}`, ticketId, "EX", 120);
  enqueue(entry);
  await redis.set(`mm:${ticketId}`, JSON.stringify({ status: "queued" }), "EX", 120);
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
  const caller = requirePlayer(c); if (!caller) return c.res;
  const gameId = c.req.param("id");
  const game   = getLiveGame(gameId);
  if (!game || game.status !== "live") return c.json({ error: "game_not_live" }, 400);
  if (caller.sub !== game.whiteId && caller.sub !== game.blackId)
    return c.json({ error: "not_a_player" }, 403);

  const key = `draw_offer:${gameId}`;
  const existing = await redis.get(key);

  if (!existing) {
    await redis.set(key, caller.sub, "EX", 30);
    roomBroadcast(gameId, { type: "draw_offered", gameId, byPlayerId: caller.sub });
    return c.json({ status: "offered" });
  }

  if (existing === caller.sub) return c.json({ status: "already_offered" });

  // Accept — both sides agreed
  await redis.del(key);
  const { endGame } = await import("./referee/game.ts");
  await endGame(game, "draw", "agreement");
  return c.json({ status: "accepted" });
});

/** POST /v1/games/:id/rematch — offer or accept a rematch */
app.post("/v1/games/:id/rematch", async (c) => {
  const caller = requirePlayer(c); if (!caller) return c.res;
  const origGameId = c.req.param("id");
  const body = { playerId: caller.sub };

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

  // If either side is a bot, schedule the bot loop for the rematch
  const botSideId = newGame.whiteKind === "bot" ? newGame.whiteId
                  : newGame.blackKind === "bot" ? newGame.blackId
                  : null;
  if (botSideId) {
    const bots = await loadBots();
    const bot = bots.find((b) => b.id === botSideId);
    if (bot) scheduleBotForGame(newGame, bot).catch((e: unknown) =>
      console.error("[rematch] bot scheduling failed:", (e as Error).message),
    );
  }

  roomBroadcast(origGameId, { type: "rematch_created", gameId: origGameId, newGameId: newGame.id });
  return c.json({ status: "created", newGameId: newGame.id });
});

/** GET /v1/watch — live and recent games for the Watch page */
app.get("/v1/watch", async (c) => {
  const rows = await sql<{
    id: string; white_id: string; black_id: string;
    white_kind: string; black_kind: string; time_control: string;
    status: string; created_at: Date;
  }[]>`
    SELECT id, white_id, black_id, white_kind, black_kind, time_control, status, created_at
    FROM games
    WHERE status IN ('live','waiting') OR (status='ended' AND ended_at > now() - interval '1 hour')
    ORDER BY
      CASE status WHEN 'live' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END,
      created_at DESC
    LIMIT 30
  `;
  const games = rows.map((r) => ({
    id:           r.id,
    white_id:     r.white_id,
    black_id:     r.black_id,
    white_kind:   r.white_kind,
    black_kind:   r.black_kind,
    time_control: r.time_control,
    status:       r.status,
    ply_count:    getLiveGame(r.id)?.plyCount ?? 0,
    created_at:   r.created_at,
  }));
  return c.json({ games });
});

// ── Agent REST API ─────────────────────────────────────────────────────────────

/** POST /v1/users/upsert — create or update a user (internal: web server → API server only) */
app.post("/v1/users/upsert", async (c) => {
  if (!requireInternal(c)) return c.res;
  const body = await c.req.json() as { id: string; handle: string; avatar?: string; xId?: string };
  if (!body.id || !body.handle) return c.json({ error: "id and handle required" }, 400);
  await sql`
    INSERT INTO users (id, handle, avatar, x_id)
    VALUES (${body.id}, ${body.handle}, ${body.avatar ?? null}, ${body.xId ?? null})
    ON CONFLICT (id) DO UPDATE SET handle=${body.handle}, avatar=COALESCE(${body.avatar ?? null}, users.avatar)
  `;
  return c.json({ ok: true });
});

/** POST /v1/agents — register an agent (requires signed-in session) */
app.post("/v1/agents", async (c) => {
  const caller = requirePlayer(c); if (!caller) return c.res;
  if (caller.type !== "user") return c.json({ error: "signed_in_user_required" }, 403);
  const body = await c.req.json() as { name: string; modelNote?: string };
  try {
    // ownerId always comes from the verified token — never from the body
    const result = await registerAgent({ ownerId: caller.sub, name: body.name, modelNote: body.modelNote });
    return c.json({
      agentId:       result.agent.id,
      name:          result.agent.name,
      apiKey:        result.apiKey,   // shown once — client must save
      walletAddress: result.walletAddress,
    }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

/** GET /v1/agents — list caller's own agents only */
app.get("/v1/agents", async (c) => {
  const caller = requirePlayer(c); if (!caller) return c.res;
  const agents = await listAgents(caller.sub);
  return c.json({ agents });
});

/** GET /v1/agent/next?wait=25 — long-poll for next event */
app.get("/v1/agent/next", async (c) => {
  const authHeader = c.req.header("Authorization") ?? "";
  const key = authHeader.replace(/^Bearer\s+/i, "").trim();
  const agent = await verifyApiKey(key);
  if (!agent) return c.json({ error: "unauthorized" }, 401);
  const wait = Math.min(25, Number(c.req.query("wait") ?? 25));
  const event = await waitForEvent(agent.id, wait);
  if (!event) return c.json({ type: "idle" });
  return c.json(event);
});

/** POST /v1/agent/queue — join matchmaking via REST */
app.post("/v1/agent/queue", async (c) => {
  const authHeader = c.req.header("Authorization") ?? "";
  const key = authHeader.replace(/^Bearer\s+/i, "").trim();
  const agent = await verifyApiKey(key);
  if (!agent) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json() as { timeControl?: TimeControl };
  const tc   = body.timeControl ?? "5+3";

  // Get agent wallet
  const wallet = await getAgentWallet(agent.id);

  const ticketId = `ticket_${agent.id}_${Date.now()}`;
  const rating   = await getRating(agent.id, "open", tc);

  const entry: QueueEntry = {
    playerId:    agent.id,
    handle:      agent.name,
    gameClass:   "open",
    timeControl: tc,
    rating,
    enqueuedAt:  Date.now(),
    walletId:    wallet?.walletId ?? "",
    address:     wallet?.address ?? "",
    kind:        "agent",
    resolve: async (opponent) => {
      if (!opponent) {
        await redis.set(`mm:${ticketId}`, JSON.stringify({ status: "no_match" }), "EX", 60);
        return;
      }
      // Game is created by the first side's resolve (the human queue handler).
      // Wait briefly then find the newly-created game for this agent.
      await new Promise<void>((r) => setTimeout(r, 500));
      const agentGame = await sql<{ id: string; white_id: string; black_id: string }[]>`
        SELECT id, white_id, black_id FROM games
        WHERE (white_id=${agent.id} OR black_id=${agent.id})
          AND status IN ('waiting','live')
        ORDER BY created_at DESC LIMIT 1
      `;
      await redis.set(`mm:${ticketId}`, JSON.stringify({ status: "matched", opponentId: opponent.playerId }), "EX", 60);
      if (agentGame[0]) {
        const g = agentGame[0];
        const gc = getLiveGame(g.id);
        const color: "w" | "b" = g.white_id === agent.id ? "w" : "b";
        await pushEvent(agent.id, {
          type:        "game_start",
          gameId:      g.id,
          color,
          opponent:    { name: opponent.playerId, kind: opponent.kind === "user" ? "human" : opponent.kind },
          timeControl: { baseSec: gc?.baseSec ?? 300, incSec: gc?.incSec ?? 3, label: tc },
        } satisfies ServerToAgent);
      }
    },
  };

  enqueue(entry);
  await redis.set(`mm:${ticketId}`, JSON.stringify({ status: "queued" }), "EX", 60);
  return c.json({ ticketId, walletAddress: wallet?.address });
});

// ── Stakes API ─────────────────────────────────────────────────────────────────

/** POST /v1/stakes — create a stake offer before game creation */
app.post("/v1/stakes", async (c) => {
  const body = await c.req.json() as {
    whiteId:     string;
    blackId:     string;
    amountUsdc6: number;  // number for JSON; convert to bigint
  };
  try {
    const offer = await createStakeOffer(body.whiteId, body.blackId, BigInt(body.amountUsdc6));
    return c.json({ stakeOfferId: offer.id, status: offer.status }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

/** GET /v1/stakes/:id — get stake offer status */
app.get("/v1/stakes/:id", async (c) => {
  const offer = await getStakeOffer(c.req.param("id"));
  if (!offer) return c.json({ error: "not_found" }, 404);
  return c.json({
    ...offer,
    amountUsdc6: offer.amountUsdc6.toString(),
  });
});

/** POST /v1/stakes/:id/open — internal: referee opens the match on-chain after game creation */
app.post("/v1/stakes/:id/open", async (c) => {
  if (!requireInternal(c)) return c.res;
  // Addresses and chainGameId come from the game row, not the request body
  const offer = await getStakeOffer(c.req.param("id"));
  if (!offer) return c.json({ error: "not_found" }, 404);
  if (!offer.gameId) return c.json({ error: "game_not_linked" }, 400);

  // Fetch game row to get authoritative addresses
  const gameRows = await sql<{
    chain_game_id: string; white_address: string; black_address: string;
    white_id: string; black_id: string;
  }[]>`SELECT chain_game_id, white_address, black_address, white_id, black_id FROM games WHERE id=${offer.gameId} LIMIT 1`;
  const gameRow = gameRows[0];
  if (!gameRow) return c.json({ error: "game_not_found" }, 404);

  // Verify ledger players match offer players (contract would revert, catch it early)
  if (offer.whiteId !== gameRow.white_id || offer.blackId !== gameRow.black_id)
    return c.json({ error: "player_mismatch" }, 400);

  try {
    const matchId = await openStakeOnChain({
      stakeOfferId:    c.req.param("id"),
      gameId:          offer.gameId,
      chainGameId:     gameRow.chain_game_id,
      whiteAddr:       gameRow.white_address,
      blackAddr:       gameRow.black_address,
      amountUsdc6:     offer.amountUsdc6,
      fundDeadlineSec: 600,
    });
    return c.json({ matchId, status: "open" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// Max stake per player: 100 USDC (testnet safety cap)
const MAX_STAKE_USDC6 = 100_000_000n;

/** POST /v1/stakes/:id/deposit — authenticated player deposits their own stake */
app.post("/v1/stakes/:id/deposit", async (c) => {
  const caller = requirePlayer(c); if (!caller) return c.res;
  const offer = await getStakeOffer(c.req.param("id"));
  if (!offer) return c.json({ error: "not_found" }, 404);

  // Only the white or black player of this offer may deposit
  if (caller.sub !== offer.whiteId && caller.sub !== offer.blackId)
    return c.json({ error: "not_a_player" }, 403);

  // Enforce amount cap
  if (offer.amountUsdc6 > MAX_STAKE_USDC6)
    return c.json({ error: "stake_exceeds_cap" }, 400);

  // Look up caller's wallet
  const walletRows = await sql<{ circle_wallet_id: string }[]>`
    SELECT circle_wallet_id FROM wallets WHERE owner_type='user' AND owner_id=${caller.sub} LIMIT 1
  `;
  const walletId = walletRows[0]?.circle_wallet_id;
  if (!walletId) return c.json({ error: "wallet_not_found" }, 404);

  if (offer.status !== "open") return c.json({ error: "match_not_open" }, 400);

  try {
    await playerApproveAndDeposit({
      stakeOfferId:    c.req.param("id"),
      playerId:        caller.sub,
      playerWalletId:  walletId,
      amountUsdc6:     offer.amountUsdc6,
    });
    const updated = await getStakeOffer(c.req.param("id"));
    return c.json({ status: updated?.status ?? "funded" });
  } catch (e) {
    // Never return raw Circle errors — strip internal detail
    console.error("[stakes] deposit error:", (e as Error).message);
    return c.json({ error: "deposit_failed" }, 500);
  }
});

/** POST /v1/stakes/:id/settle — internal: settle after game ends (idempotent) */
app.post("/v1/stakes/:id/settle", async (c) => {
  if (!requireInternal(c)) return c.res;
  const offer = await getStakeOffer(c.req.param("id"));
  if (!offer) return c.json({ error: "not_found" }, 404);
  try {
    await settleMatch(c.req.param("id"));
    return c.json({ status: "settled" });
  } catch {
    return c.json({ error: "settle_failed" }, 500);
  }
});

/** POST /v1/stakes/:id/cancel — internal/admin: cancel unfunded match after deadline */
app.post("/v1/stakes/:id/cancel", async (c) => {
  if (!requireInternal(c)) return c.res;
  const offer = await getStakeOffer(c.req.param("id"));
  if (!offer) return c.json({ error: "not_found" }, 404);
  try {
    await cancelUnfunded(c.req.param("id"));
    return c.json({ status: "cancelled" });
  } catch {
    return c.json({ error: "cancel_failed" }, 500);
  }
});

/** POST /v1/stakes/:id/timeout-refund — internal/admin: refund both after 24h timeout */
app.post("/v1/stakes/:id/timeout-refund", async (c) => {
  if (!requireInternal(c)) return c.res;
  const offer = await getStakeOffer(c.req.param("id"));
  if (!offer) return c.json({ error: "not_found" }, 404);
  try {
    await refundAfterTimeout(c.req.param("id"));
    return c.json({ status: "refunded" });
  } catch {
    return c.json({ error: "refund_failed" }, 500);
  }
});

/** GET /v1/wallet/:userId — USDC balance + recent transfers (self only) */
app.get("/v1/wallet/:userId", async (c) => {
  const caller = requirePlayer(c); if (!caller) return c.res;
  const userId = c.req.param("userId");
  if (caller.sub !== userId) return c.json({ error: "forbidden" }, 403);
  const walletRows = await sql<{ circle_wallet_id: string; address: string }[]>`
    SELECT circle_wallet_id, address FROM wallets WHERE owner_id=${userId} LIMIT 1
  `;
  const wallet = walletRows[0];
  if (!wallet) return c.json({ error: "wallet_not_found" }, 404);

  const { getWalletBalances } = await import("./chain/circle.ts");
  const balances = await getWalletBalances(wallet.circle_wallet_id).catch(() => []);
  const usdc = balances.find((b) => b.token.symbol === "USDC");
  const balanceUsdc6 = usdc ? Math.round(parseFloat(usdc.amount) * 1_000_000) : 0;

  // Recent stake deposits by this user
  const stakes = await sql<{
    stake_offer_id: string; state: string; tx_hash: string | null; created_at: Date;
  }[]>`
    SELECT stake_offer_id, state, tx_hash, created_at
    FROM stake_deposits WHERE player_id=${userId}
    ORDER BY created_at DESC LIMIT 20
  `;

  return c.json({
    walletAddress: wallet.address,
    balanceUsdc6,
    balanceDisplay: (balanceUsdc6 / 1_000_000).toFixed(2),
    isTestnet: cfg.NETWORK === "testnet",
    deposits: stakes.map((s) => ({
      stakeOfferId: s.stake_offer_id,
      state:        s.state,
      txHash:       s.tx_hash,
      explorerUrl:  s.tx_hash ? `${cfg.ARC_EXPLORER}/tx/${s.tx_hash}` : null,
      createdAt:    s.created_at,
    })),
  });
});

// ── Tournament API ─────────────────────────────────────────────────────────────

/** GET /v1/tournaments — list tournaments */
app.get("/v1/tournaments", async (c) => {
  const status = c.req.query("status");
  const list = await listTournaments(status);
  return c.json({ tournaments: list.map(formatTournament) });
});

/** POST /v1/tournaments — create a tournament (admin only) */
app.post("/v1/tournaments", async (c) => {
  if (!requireAdmin(c)) return c.res;
  const body = await c.req.json() as {
    name:        string;
    gameClass?:  "open" | "human";
    timeControl?: string;
    regClose:    string;   // ISO8601
    startsAt:    string;   // ISO8601
    prizeUsdc6?: number;   // prize pool (sponsor funds it)
    sponsoredBy?: string;
  };
  try {
    const t = await createTournament({
      name:        body.name,
      gameClass:   body.gameClass ?? "open",
      timeControl: body.timeControl ?? "5+3",
      regClose:    new Date(body.regClose),
      startsAt:    new Date(body.startsAt),
      prizeUsdc6:  BigInt(body.prizeUsdc6 ?? 0),
      sponsoredBy: body.sponsoredBy ?? "sponsor",
    });
    return c.json(formatTournament(t), 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

/** GET /v1/tournaments/:id — full tournament state */
app.get("/v1/tournaments/:id", async (c) => {
  const t = await getTournament(c.req.param("id"));
  if (!t) return c.json({ error: "not_found" }, 404);
  const [entries, games] = await Promise.all([
    getTournamentEntries(t.id),
    getTournamentGames(t.id),
  ]);
  return c.json({
    ...formatTournament(t),
    entries: entries.map((e) => ({
      playerId:   e.player_id,
      playerKind: e.player_kind,
      placement:  e.placement,
      prizeUsdc6: e.prize_usdc6?.toString() ?? "0",
    })),
    games,
    bracket: t.bracket_json ? JSON.parse(t.bracket_json).bracket : null,
  });
});

/** POST /v1/tournaments/:id/register — enter the tournament (self only) */
app.post("/v1/tournaments/:id/register", async (c) => {
  const caller = requirePlayer(c); if (!caller) return c.res;
  try {
    await registerEntry({
      tournamentId: c.req.param("id"),
      playerId:     caller.sub,       // always from token — never from body
      playerKind:   (caller.type === "agent" ? "agent" : "user") as "user" | "agent" | "bot",
    });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

/** POST /v1/tournaments/:id/start — admin only */
app.post("/v1/tournaments/:id/start", async (c) => {
  if (!requireAdmin(c)) return c.res;
  try {
    await startTournament(c.req.param("id"));

    // Auto-play any bot participants
    const t = await getTournament(c.req.param("id"));
    if (t) await scheduleTournamentBots(t.id);

    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

/** POST /v1/tournaments/:id/finalize — admin only */
app.post("/v1/tournaments/:id/finalize", async (c) => {
  if (!requireAdmin(c)) return c.res;
  try {
    const { forceFinalizeIfComplete } = await import("./tournaments/index.ts");
    const done = await forceFinalizeIfComplete(c.req.param("id"));
    return c.json({ ok: true, alreadyDone: !done });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

/** POST /v1/tournaments/:id/fund — admin only: treasury funds the prize pool */
app.post("/v1/tournaments/:id/fund", async (c) => {
  if (!requireAdmin(c)) return c.res;
  try {
    await fundTournament(c.req.param("id"));
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

function formatTournament(t: {
  id: string; name: string; class: string; time_control: string;
  entry_fee_usdc6: bigint; prize_pool_usdc6: bigint;
  reg_close: Date; starts_at: Date; status: string;
  chain_tid: string | null; bracket_json?: string | null;
}) {
  return {
    id:             t.id,
    name:           t.name,
    class:          t.class,
    timeControl:    t.time_control,
    entryFeeUsdc6:  t.entry_fee_usdc6?.toString() ?? "0",
    prizePoolUsdc6: t.prize_pool_usdc6?.toString() ?? "0",
    regClose:       t.reg_close,
    startsAt:       t.starts_at,
    status:         t.status,
    chainTid:       t.chain_tid,
  };
}

// ── Stage 8: Replay / Profile / HvM / Share-card ─────────────────────────────

/** GET /v1/games/:id/replay — full game from DB + chain events */
app.get("/v1/games/:id/replay", async (c) => {
  const id = c.req.param("id");
  const rows = await sql<{
    id: string; white_id: string; white_kind: string; black_id: string; black_kind: string;
    class: string; time_control: string; status: string; result: string | null;
    reason: string | null; chain_game_id: string | null; pgn: string | null;
    created_at: Date; ended_at: Date | null; white_address: string; black_address: string;
  }[]>`SELECT * FROM games WHERE id=${id}`;
  if (!rows[0]) return c.json({ error: "not_found" }, 404);
  const game = rows[0];

  // Moves with chain state
  const moves = await sql<{
    ply: number; uci: string; san: string | null; fen_after: string;
    clock_w_ms: number; clock_b_ms: number; state: string;
    tx_hash: string | null; block: bigint | null;
    submitted_at: Date | null; final_at: Date | null; relayed: boolean;
  }[]>`SELECT * FROM moves WHERE game_id=${id} ORDER BY ply`;

  // Chain events for this game's chain_game_id — exact match via the dedicated
  // indexed column (populated by migration 009 + indexer QA Round 4A).
  let chainEvents: { event_name: string; args_json: string; tx_hash: string; block_number: bigint }[] = [];
  if (game.chain_game_id) {
    chainEvents = await sql<{ event_name: string; args_json: string; tx_hash: string; block_number: bigint }[]>`
      SELECT event_name, args_json, tx_hash, block_number FROM chain_events
      WHERE chain_game_id = ${game.chain_game_id}
      ORDER BY block_number, id
    `;
  }

  // Player info
  const [whiteUser, blackUser] = await Promise.all([
    sql<{ handle: string; avatar: string | null }[]>`SELECT handle, avatar FROM users WHERE id=${game.white_id}`,
    sql<{ handle: string; avatar: string | null }[]>`SELECT handle, avatar FROM users WHERE id=${game.black_id}`,
  ]);

  return c.json({
    game: {
      id: game.id,
      whiteId: game.white_id,
      whiteKind: game.white_kind,
      whiteName: whiteUser[0]?.handle ?? game.white_id,
      whiteAvatar: whiteUser[0]?.avatar ?? null,
      whiteAddress: game.white_address,
      blackId: game.black_id,
      blackKind: game.black_kind,
      blackName: blackUser[0]?.handle ?? game.black_id,
      blackAvatar: blackUser[0]?.avatar ?? null,
      blackAddress: game.black_address,
      class: game.class,
      timeControl: game.time_control,
      status: game.status,
      result: game.result,
      reason: game.reason,
      chainGameId: game.chain_game_id,
      pgn: game.pgn,
      createdAt: game.created_at,
      endedAt: game.ended_at,
    },
    moves: moves.map((m) => ({
      ply: m.ply,
      uci: m.uci,
      san: m.san,
      fenAfter: m.fen_after,
      clockWMs: m.clock_w_ms,
      clockBMs: m.clock_b_ms,
      state: m.state,
      txHash: m.tx_hash,
      block: m.block ? Number(m.block) : null,
      finalAt: m.final_at,
      relayed: m.relayed,
    })),
    chainEvents: chainEvents.map((e) => ({
      eventName: e.event_name,
      args: JSON.parse(e.args_json),
      txHash: e.tx_hash,
      blockNumber: Number(e.block_number),
    })),
  });
});

/** GET /v1/profile/:id — player profile, games, rating, streaks, titles */
app.get("/v1/profile/:id", async (c) => {
  const id = c.req.param("id");

  // User or agent info
  const userRows = await sql<{ id: string; handle: string; avatar: string | null; created_at: Date }[]>`
    SELECT id, handle, avatar, created_at FROM users WHERE id=${id}
  `;
  const agentRows = userRows.length === 0
    ? await sql<{ id: string; name: string; model_note: string | null; created_at: Date }[]>`
        SELECT id, name, model_note, created_at FROM agents WHERE id=${id}
      `
    : [];

  if (userRows.length === 0 && agentRows.length === 0) {
    // Could be a bot — return minimal profile
    if (!id.startsWith("bot_")) return c.json({ error: "not_found" }, 404);
  }

  // Recent games
  const recentGames = await sql<{
    id: string; white_id: string; black_id: string; result: string | null;
    time_control: string; class: string; created_at: Date;
  }[]>`
    SELECT id, white_id, black_id, result, time_control, class, created_at
    FROM games
    WHERE (white_id=${id} OR black_id=${id})
      AND status IN ('ended','aborted')
    ORDER BY created_at DESC LIMIT 20
  `;

  // Ratings
  const ratings = await sql<{
    class: string; time_control: string; mu: number; sigma: number; games: number;
  }[]>`SELECT class, time_control, mu, sigma, games FROM ratings WHERE subject_id=${id}`;

  // Streaks
  const streaks = await sql<{
    class: string; current_streak: number; best_streak: number;
  }[]>`SELECT class, current_streak, best_streak FROM streaks WHERE subject_id=${id}`;

  // Titles
  const titles = await sql<{ title: string; earned_at: Date }[]>`
    SELECT title, earned_at FROM titles WHERE subject_id=${id} ORDER BY earned_at
  `;

  // Win/draw/loss counts
  const statsRows = await sql<{ result: string; cnt: bigint }[]>`
    SELECT result, COUNT(*) as cnt FROM games
    WHERE (white_id=${id} OR black_id=${id}) AND status='ended'
    GROUP BY result
  `;
  const stats = { wins: 0, draws: 0, losses: 0, total: 0 };
  for (const r of statsRows) {
    const n = Number(r.cnt);
    stats.total += n;
    if (r.result === "draw") stats.draws += n;
    else if ((r.result === "white" && (await sql<{white_id:string}[]>`SELECT white_id FROM games WHERE white_id=${id} AND result='white' LIMIT 1`).length > 0) ||
             (r.result === "black" && id === "dummy")) {
      // simplified — count separately below
    }
  }
  // Cleaner win/loss count
  // Stats count decided games only (not aborted)
  const winsW  = await sql<{cnt:string}[]>`SELECT COUNT(*) as cnt FROM games WHERE white_id=${id} AND result='white'  AND status IN ('ended','aborted')`;
  const winsB  = await sql<{cnt:string}[]>`SELECT COUNT(*) as cnt FROM games WHERE black_id=${id} AND result='black'  AND status IN ('ended','aborted')`;
  const drawsQ = await sql<{cnt:string}[]>`SELECT COUNT(*) as cnt FROM games WHERE (white_id=${id} OR black_id=${id}) AND result='draw' AND status='ended'`;
  const lossW  = await sql<{cnt:string}[]>`SELECT COUNT(*) as cnt FROM games WHERE white_id=${id} AND result='black'  AND status='ended'`;
  const lossB  = await sql<{cnt:string}[]>`SELECT COUNT(*) as cnt FROM games WHERE black_id=${id} AND result='white'  AND status='ended'`;

  const wins   = Number(winsW[0]?.cnt ?? 0) + Number(winsB[0]?.cnt ?? 0);
  const draws  = Number(drawsQ[0]?.cnt ?? 0);
  const losses = Number(lossW[0]?.cnt ?? 0) + Number(lossB[0]?.cnt ?? 0);

  const profile = userRows[0]
    ? { id, kind: "user", name: userRows[0].handle, avatar: userRows[0].avatar, createdAt: userRows[0].created_at }
    : agentRows[0]
    ? { id, kind: "agent", name: agentRows[0].name, modelNote: agentRows[0].model_note, createdAt: agentRows[0].created_at }
    : { id, kind: "bot", name: id, createdAt: null };

  return c.json({
    profile,
    stats: { wins, draws, losses, total: wins + draws + losses },
    ratings: ratings.map((r) => ({
      class: r.class,
      timeControl: r.time_control,
      mu: r.mu,
      sigma: r.sigma,
      games: r.games,
      conservative: Math.round(r.mu - 3 * r.sigma),
    })),
    streaks,
    titles: titles.map((t) => ({ title: t.title, earnedAt: t.earned_at })),
    recentGames: recentGames.map((g) => ({
      id: g.id,
      whiteId: g.white_id,
      blackId: g.black_id,
      result: g.result,
      timeControl: g.time_control,
      class: g.class,
      createdAt: g.created_at,
      playerColor: g.white_id === id ? "w" : "b",
      playerResult: g.result === "draw" ? "draw"
                  : (g.white_id === id && g.result === "white") || (g.black_id === id && g.result === "black") ? "win"
                  : g.result === "aborted" ? "aborted" : "loss",
    })),
  });
});

/** GET /v1/hvm — Humans vs Machines running tally */
app.get("/v1/hvm", async (c) => {
  // Live tally from games table (source of truth)
  const rows = await sql<{ kind: string; result: string; cnt: bigint }[]>`
    SELECT
      CASE
        WHEN white_kind IN ('user') AND result='white' THEN 'human_win'
        WHEN black_kind IN ('user') AND result='black' THEN 'human_win'
        WHEN white_kind IN ('bot','agent') AND result='white' THEN 'machine_win'
        WHEN black_kind IN ('bot','agent') AND result='black' THEN 'machine_win'
        WHEN result='draw' THEN 'draw'
        ELSE 'other'
      END as kind,
      result,
      COUNT(*) as cnt
    FROM games
    WHERE status='ended'
      AND result IN ('white','black','draw')
      AND (
        (white_kind='user' AND black_kind IN ('bot','agent')) OR
        (black_kind='user' AND white_kind IN ('bot','agent'))
      )
    GROUP BY 1, 2
  `;

  let humanWins = 0, machineWins = 0, draws = 0;
  for (const r of rows) {
    const n = Number(r.cnt);
    if (r.kind === "human_win") humanWins += n;
    else if (r.kind === "machine_win") machineWins += n;
    else if (r.kind === "draw") draws += n;
  }
  const total = humanWins + machineWins + draws;

  return c.json({
    humanWins,
    machineWins,
    draws,
    total,
    humanPct: total > 0 ? Math.round(humanWins * 100 / total) : 0,
    machinePct: total > 0 ? Math.round(machineWins * 100 / total) : 0,
    drawPct: total > 0 ? Math.round(draws * 100 / total) : 0,
  });
});

/** GET /v1/games/:id/share — share card metadata for OG */
app.get("/v1/games/:id/share", async (c) => {
  const id = c.req.param("id");
  const rows = await sql<{
    white_id: string; white_kind: string; black_id: string; black_kind: string;
    result: string | null; reason: string | null; time_control: string;
    ended_at: Date | null; pgn: string | null;
  }[]>`SELECT white_id, white_kind, black_id, black_kind, result, reason,
             time_control, ended_at, pgn FROM games WHERE id=${id}`;
  if (!rows[0]) return c.json({ error: "not_found" }, 404);
  const g = rows[0];

  const [wUser, bUser] = await Promise.all([
    sql<{ handle: string; avatar: string | null }[]>`SELECT handle, avatar FROM users WHERE id=${g.white_id}`,
    sql<{ handle: string; avatar: string | null }[]>`SELECT handle, avatar FROM users WHERE id=${g.black_id}`,
  ]);

  const totalMoves = await sql<{ cnt: string }[]>`SELECT COUNT(*) as cnt FROM moves WHERE game_id=${id}`;
  const moveCount = Number(totalMoves[0]?.cnt ?? 0);

  const resultLabel =
    g.result === "white" ? `${wUser[0]?.handle ?? g.white_id} wins`
    : g.result === "black" ? `${bUser[0]?.handle ?? g.black_id} wins`
    : g.result === "draw"  ? "Draw"
    : "Game";

  return c.json({
    gameId: id,
    whiteName: wUser[0]?.handle ?? g.white_id,
    whiteAvatar: wUser[0]?.avatar ?? null,
    blackName: bUser[0]?.handle ?? g.black_id,
    blackAvatar: bUser[0]?.avatar ?? null,
    result: g.result,
    reason: g.reason,
    resultLabel,
    timeControl: g.time_control,
    moveCount,
    endedAt: g.ended_at,
    xShareText: `${resultLabel} in ${moveCount} moves on Arc. Every move is on-chain. Verify it at finalmo.ve/g/${id} #FinalMove`,
  });
});

// ── MCP ────────────────────────────────────────────────────────────────────────
app.route("/mcp", mcpRouter);

// ── Bot auto-play loop ─────────────────────────────────────────────────────────

// Per-bot minimum think time in ms (on top of a small random jitter).
// Depths 1-5 map to bot_1-bot_5; higher depth = slower but not unbearable.
const BOT_THINK_MIN_MS: Record<string, number> = {
  bot_1: 600,
  bot_2: 900,
  bot_3: 1_400,
  bot_4: 2_000,
  bot_5: 3_000,
};
const BOT_THINK_JITTER_MS = 400; // up to +400ms random per move

async function scheduleBot(gameId: string, botId: string, botColor: "w" | "b") {
  // One loop per (gameId, botColor) pair — prevent duplicate loops from
  // scheduleTournamentBots polling every 3 s.
  const key = `${gameId}:${botColor}`;
  const { scheduledBotGames } = await import("./referee/game.ts");
  if (scheduledBotGames.has(key)) return;
  scheduledBotGames.add(key);

  const { getBotMove } = await import("./bots/index.ts");
  const minThink = BOT_THINK_MIN_MS[botId] ?? 1_000;

  const play = async () => {
    const game = getLiveGame(gameId);
    if (!game || game.status === "ended" || game.status === "aborted") return;

    const turn = game.plyCount % 2 === 0 ? "w" : "b";
    if (turn !== botColor) {
      setTimeout(play, 300);
      return;
    }

    // Human-like think delay before the bot commits its move
    const thinkMs = minThink + Math.floor(Math.random() * BOT_THINK_JITTER_MS);
    await new Promise<void>((r) => setTimeout(r, thinkMs));

    // Re-check after the delay — game may have ended while "thinking"
    const gameNow = getLiveGame(gameId);
    if (!gameNow || gameNow.status === "ended" || gameNow.status === "aborted") return;

    const uci = await getBotMove(botId, gameNow.position);
    if (!uci) return;

    const result = await handleMove(gameId, botId, uci);
    if (!result.ok) return;

    if (!result.over) {
      setTimeout(play, 100); // tight poll — think delay happens at the top of the next call
    } else {
      scheduledBotGames.delete(key);
    }
  };

  // Small startup delay so the game row is committed before the first move
  setTimeout(play, 400);
}

/** Schedule a bot for a newly-created game where one side is a bot. */
async function scheduleBotForGame(game: import("./referee/game.ts").LiveGame, bot: { id: string }) {
  const botColor = game.whiteId === bot.id ? "w" : "b";
  await scheduleBot(game.id, bot.id, botColor);
}

// ── Tournament bot auto-play ───────────────────────────────────────────────────

async function scheduleTournamentBots(tournamentId: string) {
  // Watch for new tournament_games and schedule bot auto-play
  const watchAndSchedule = async () => {
    const rows = await sql<{ game_id: string; white_player_id: string; black_player_id: string }[]>`
      SELECT game_id, white_player_id, black_player_id
      FROM tournament_games
      WHERE tournament_id=${tournamentId} AND winner_id IS NULL
    `;
    for (const row of rows) {
      const game = getLiveGame(row.game_id);
      if (!game || game.status === "ended" || game.status === "aborted") continue;
      const wBot = getBot(row.white_player_id);
      const bBot = getBot(row.black_player_id);
      if (wBot) scheduleBot(row.game_id, row.white_player_id, "w");
      if (bBot) scheduleBot(row.game_id, row.black_player_id, "b");
    }
  };

  // Poll until tournament is done
  const poll = async () => {
    const t = await getTournament(tournamentId);
    if (!t || t.status === "done" || t.status === "cancelled") return;
    await watchAndSchedule();
    setTimeout(poll, 3_000);
  };
  setTimeout(poll, 1_000);
}

import { setMaps, rehydrateLiveGames } from "./referee/rehydrate.ts";

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

// ── WebSocket servers (noServer mode — one httpServer.on("upgrade") routes) ───
// Binding both servers to the same httpServer with path: causes a race where the
// second server's abortHandshake fires on an already-consumed socket and throws
// ERR_STREAM_ALREADY_FINISHED under Bun, crashing the process.
// Fix: noServer:true on both; one upgrade handler dispatches by pathname.

const wss      = new WebSocketServer({ noServer: true });
const agentWss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const url  = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  if (path === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else if (path === "/v1/agent") {
    agentWss.handleUpgrade(req, socket, head, (ws) => agentWss.emit("connection", ws, req));
  } else {
    // Unknown path — refuse cleanly without crashing
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
  }
});

// ── WebSocket: browser clients (/ws) ─────────────────────────────────────────

// gameId → Map<playerId, WebSocket>
const gameRooms  = new Map<string, Map<string, WebSocket>>();
const playerGame = new Map<string, string>();

// Maps wired in main() after rehydration module is ready

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
    // Pass baseSec so clocks show the full time before the first move is made
    const clocks = await getClocks(gameId, game.baseSec);
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

// WS payload cap (4 KB)
const WS_MAX_PAYLOAD = 4_096;
// Per-socket message rate limit: max 30 messages per 10 s
const WS_RATE_WINDOW_MS  = 10_000;
const WS_RATE_MAX_MSGS   = 30;

wss.on("connection", (ws) => {
  let myPlayerId = "";
  let myGameId   = "";
  let msgCount   = 0;
  let rateWindowStart = Date.now();

  ws.on("message", async (raw) => {
    // Payload cap
    const payload = raw.toString();
    if (Buffer.byteLength(payload) > WS_MAX_PAYLOAD) {
      ws.send(JSON.stringify({ type: "error", reason: "payload_too_large" }));
      return;
    }

    // Rate limit
    const now = Date.now();
    if (now - rateWindowStart > WS_RATE_WINDOW_MS) {
      msgCount = 0;
      rateWindowStart = now;
    }
    msgCount++;
    if (msgCount > WS_RATE_MAX_MSGS) {
      ws.send(JSON.stringify({ type: "error", reason: "rate_limited" }));
      return;
    }

    try {
      const msg = JSON.parse(payload) as {
        type: string; gameId?: string; token?: string; uci?: string;
      };

      if (msg.type === "join" && msg.gameId && msg.token) {
        // Derive identity from the signed token — never trust a client-supplied playerId
        const tokenPayload = verifyToken(msg.token);
        if (!tokenPayload) {
          ws.send(JSON.stringify({ type: "error", reason: "invalid_token" }));
          return;
        }
        myGameId   = msg.gameId;
        myPlayerId = tokenPayload.sub;

        if (!gameRooms.has(myGameId)) gameRooms.set(myGameId, new Map());
        gameRooms.get(myGameId)!.set(myPlayerId, ws);
        playerGame.set(myPlayerId, myGameId);

        const state = await buildFullGameState(myGameId);
        if (state && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(state));
        }
      }

      if (msg.type === "move" && msg.gameId && msg.uci && myPlayerId) {
        // Verify caller is a player in this game
        const liveGame = getLiveGame(msg.gameId);
        if (liveGame && myPlayerId !== liveGame.whiteId && myPlayerId !== liveGame.blackId) {
          ws.send(JSON.stringify({ type: "move_rejected", reason: "not_a_player" }));
          return;
        }
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

  // Forward to agent connections + send your_turn / opponent_move
  const game = getLiveGame(gameId);
  if (!game) return;
  let parsed: { type?: string; uci?: string; ply?: number; fen?: string } = {};
  try { parsed = JSON.parse(message); } catch {}

  for (const pid of [game.whiteId, game.blackId]) {
    const ws = agentConnections.get(pid);
    if (!ws || ws.readyState !== WebSocket.OPEN) continue;

    // Always forward raw game events (chain, clock, game_end, etc.)
    ws.send(message);

    // On move events: send opponent_move to the one who didn't move, your_turn to the one who should move next
    if (parsed.type === "move" && parsed.uci && parsed.ply !== undefined) {
      const color: "w" | "b" = game.plyCount % 2 === 0 ? "w" : "b"; // after the move was applied
      const whoJustMoved = ((game.plyCount - 1) % 2 === 0) ? "w" : "b";
      const moverId = whoJustMoved === "w" ? game.whiteId : game.blackId;
      const nextId  = whoJustMoved === "w" ? game.blackId : game.whiteId;

      if (pid !== moverId) {
        // Opponent sees opponent_move
        const oppMsg: ServerToAgent = {
          type: "opponent_move",
          gameId,
          ply:  parsed.ply,
          uci:  parsed.uci,
          fen:  parsed.fen ?? toFEN(game.position),
          clockMs: { w: 0, b: 0 },
        };
        ws.send(JSON.stringify(oppMsg));
      }

      if (pid === nextId) {
        // The one to move gets your_turn (async, don't await in pmessage)
        sendYourTurn(gameId, pid, color).catch(() => {});
      }
    }
  }
});

// ── WebSocket: agent API (/v1/agent) ──────────────────────────────────────────

const agentConnections = new Map<string, WebSocket>(); // agentId → ws

agentWss.on("connection", (ws, req) => {
  let agentId   = "";
  let agentName = "";
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lastPong  = Date.now();
  let onMoveSilenceTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Auth ───────────────────────────────────────────────────────────────────
  const authHeader = req.headers["authorization"] ?? "";
  const apiKey = authHeader.replace(/^Bearer\s+/i, "").trim();

  // Auth happens before first message; reject non-authed connections after 5s
  const authTimeout = setTimeout(() => {
    if (!agentId) ws.close(4001, "auth_timeout");
  }, 5_000);

  const send = (msg: ServerToAgent) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  // Perform async auth immediately
  verifyApiKey(apiKey).then((agent) => {
    clearTimeout(authTimeout);
    if (!agent) { ws.close(4001, "unauthorized"); return; }
    agentId   = agent.id;
    agentName = agent.name;
    agentConnections.set(agentId, ws);

    send({ type: "hello", agentId, name: agentName });

    // ── Heartbeat (15s ping, 60s timeout) ─────────────────────────────────
    ws.on("pong", () => { lastPong = Date.now(); });
    heartbeat = setInterval(() => {
      if (Date.now() - lastPong > 60_000) {
        ws.terminate();
        return;
      }
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 15_000);
  }).catch(() => ws.close(4001, "unauthorized"));

  // ── Message handler ────────────────────────────────────────────────────────
  ws.on("message", async (raw) => {
    if (!agentId) return; // not authed yet
    try {
      const msg = JSON.parse(raw.toString()) as AgentToServer & { type: string };

      if (msg.type === "queue") {
        // Join matchmaking
        const qMsg = msg as { type: "queue"; timeControl: TimeControl };
        const tc   = qMsg.timeControl ?? "5+3";
        const rating = await getRating(agentId, "open", tc);
        const wallet = await getAgentWallet(agentId);

        const entry: QueueEntry = {
          playerId:    agentId,
          handle:      agentName,
          gameClass:   "open",
          timeControl: tc,
          rating,
          enqueuedAt:  Date.now(),
          walletId:    wallet?.walletId ?? "",
          address:     wallet?.address ?? "",
          kind:        "agent",
          resolve: async (opponent) => {
            if (!opponent) return; // no match, agent can re-queue
            // Game is created by the human side's resolve; wait briefly then find it
            await new Promise<void>((r) => setTimeout(r, 500));
            const rows = await sql<{
              id: string; white_id: string; black_id: string;
              white_kind: string; black_kind: string; base_sec: number; inc_sec: number; time_control: string;
            }[]>`
              SELECT id, white_id, black_id, white_kind, black_kind, base_sec, inc_sec, time_control
              FROM games
              WHERE (white_id=${agentId} OR black_id=${agentId})
                AND status IN ('waiting','live')
              ORDER BY created_at DESC LIMIT 1
            `;
            if (!rows[0]) return;
            const g = rows[0];
            const color: "w" | "b" = g.white_id === agentId ? "w" : "b";
            send({
              type:        "game_start",
              gameId:      g.id,
              color,
              opponent:    { name: opponent.playerId, kind: opponent.kind === "user" ? "human" : opponent.kind },
              timeControl: { baseSec: g.base_sec, incSec: g.inc_sec, label: g.time_control as TimeControl },
            });
            const game = getLiveGame(g.id);
            if (game) sendYourTurn(g.id, agentId, color);
          },
        };

        // If agent has no wallet yet, inform but allow play (referee relays)
        if (!wallet) {
          console.warn(`[ws:agent] ${agentId} has no wallet — moves will be relayed`);
        }

        enqueue(entry);

      } else if (msg.type === "move") {
        if (onMoveSilenceTimer) { clearTimeout(onMoveSilenceTimer); onMoveSilenceTimer = null; }
        const result = await handleMove(msg.gameId, agentId, msg.uci);
        if (result.ok) {
          send({ type: "move_ack", gameId: msg.gameId, ply: result.fen ? 0 : 0, uci: msg.uci });
        } else {
          send({ type: "move_rejected", gameId: msg.gameId, reason: (result as { reason: string }).reason });
        }

      } else if (msg.type === "resign") {
        await handleResign(msg.gameId, agentId);

      } else if (msg.type === "offer_draw") {
        const key = `draw_offer:${msg.gameId}`;
        const existing = await redis.get(key);
        if (!existing) {
          await redis.set(key, agentId, "EX", 30);
          roomBroadcast(msg.gameId, { type: "draw_offered", gameId: msg.gameId });
        } else if (existing !== agentId) {
          await redis.del(key);
          const { endGame } = await import("./referee/game.ts");
          const game = getLiveGame(msg.gameId);
          if (game) await endGame(game, "draw", "agreement");
        }

      } else if (msg.type === "accept_draw") {
        const key = `draw_offer:${msg.gameId}`;
        const existing = await redis.get(key);
        if (existing && existing !== agentId) {
          await redis.del(key);
          const { endGame } = await import("./referee/game.ts");
          const game = getLiveGame(msg.gameId);
          if (game) await endGame(game, "draw", "agreement");
        }
      }
    } catch (e) {
      console.error("[ws:agent] error:", (e as Error).message);
    }
  });

  ws.on("close", () => {
    if (heartbeat) clearInterval(heartbeat);
    if (onMoveSilenceTimer) clearTimeout(onMoveSilenceTimer);
    if (agentId) agentConnections.delete(agentId);
  });
});

// Send your_turn to an agent's WS (or push to REST event queue)
async function sendYourTurn(gameId: string, agentId: string, _color: "w" | "b") {
  const game = getLiveGame(gameId);
  if (!game || game.status !== "live") return;
  let wMs = 0, bMs = 0;
  try { const c = await getClocks(gameId); wMs = c.wMs; bMs = c.bMs; } catch {}
  const legal = legalMoves(game.position).map((m) => moveToUci(m));
  const msg: ServerToAgent = {
    type:    "your_turn",
    gameId,
    ply:     game.plyCount,
    fen:     toFEN(game.position),
    moves:   legal,
    clockMs: { w: wMs, b: bMs },
  };
  const ws = agentConnections.get(agentId);
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    // REST fallback
    await pushEvent(agentId, msg);
  }
}

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

  // Wire pruning hook before rehydration so map cleanup works on reloaded games
  const { liveGames: lg, setPruneHook } = await import("./referee/game.ts");
  const { pruneMaps: pruneFn } = await import("./referee/rehydrate.ts");
  setPruneHook(pruneFn);
  setMaps(lg as Map<string, import("./referee/game.ts").LiveGame>, gameRooms, playerGame);

  // Rehydrate live/waiting games from DB before accepting connections
  await rehydrateLiveGames().catch((e) => console.error("[rehydrate] failed:", (e as Error).message));

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
      // Also persist to Postgres so it survives Redis flush
      await sql`INSERT INTO indexer_state (key, value) VALUES ('indexer_head', ${String(head - 50n)})
                ON CONFLICT (key) DO UPDATE SET value=${String(head - 50n)}`;
      await redis.set("indexer:head", String(head - 50n));
      console.log(`[server] indexer head initialized to ${head - 50n}`);
    }
  }

  await startIndexer();

  httpServer.listen(cfg.PORT, () => {
    console.log(`[server] ready on :${cfg.PORT}`);
  });
}

// ── Graceful shutdown (SIGTERM) ───────────────────────────────────────────────

process.on("SIGTERM", () => {
  console.log("[server] SIGTERM received — shutting down gracefully");
  httpServer.close(() => {
    console.log("[server] HTTP server closed");
    // Let in-flight WS connections drain for up to 5 s
    setTimeout(() => {
      sql.end().catch(() => {}).finally(() => process.exit(0));
    }, 5_000);
  });
  // Stop accepting new connections immediately
  httpServer.closeAllConnections?.();
});

// ── Top-level error guards ─────────────────────────────────────────────────────
// Log with context instead of silently crashing; compose restart: unless-stopped
// handles restarts so we exit non-zero to trigger a clean restart.
process.on("uncaughtException", (err: Error) => {
  console.error("[server] uncaughtException — restarting:", err?.stack ?? err?.message ?? err);
  process.exit(1);
});
process.on("unhandledRejection", (reason: unknown) => {
  console.error("[server] unhandledRejection — continuing:", reason);
  // Do NOT exit on unhandled promise rejections — most are recoverable network errors.
});

main().catch((e) => {
  console.error("[server] fatal:", e);
  process.exit(1);
});
