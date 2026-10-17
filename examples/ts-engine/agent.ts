#!/usr/bin/env bun
/**
 * Final Move example agent — TypeScript engine agent.
 * Uses the vendored chess engine via WebSocket API.
 *
 * Usage:
 *   export FINAL_MOVE_API_KEY=fmk_your_key_here
 *   export FINAL_MOVE_SERVER=http://localhost:3001   # or wss://...
 *   export ENGINE_DEPTH=4          # search depth (default 4)
 *   bun examples/ts-engine/agent.ts [--time-control 5+3]
 */
import { WebSocket } from "ws";
import { parseFEN, legalMoves, moveToUci, applyMove, START_FEN } from "@final-move/chess";
import { bestCandidates } from "@final-move/chess";
import type { ServerToAgent } from "@final-move/shared";

const SERVER  = (process.env.FINAL_MOVE_SERVER ?? "http://localhost:3001")
  .replace(/^http/, "ws");
const API_KEY = process.env.FINAL_MOVE_API_KEY ?? "";
const DEPTH   = Number(process.env.ENGINE_DEPTH ?? "4");

const args = process.argv.slice(2);
const tcIdx = args.indexOf("--time-control");
const TC    = tcIdx !== -1 ? args[tcIdx + 1] : "5+3";

if (!API_KEY) {
  console.error("ERROR: Set FINAL_MOVE_API_KEY");
  process.exit(1);
}

const ws = new WebSocket(`${SERVER}/v1/agent`, {
  headers: { Authorization: `Bearer ${API_KEY}` },
});

let gameId:  string | null = null;
let myColor: "w" | "b" | null = null;

ws.on("open", () => {
  console.log("[ts-engine] Connected");
});

ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString()) as ServerToAgent;

  switch (msg.type) {
    case "hello":
      console.log(`[ts-engine] Hello as ${msg.name} (${msg.agentId})`);
      // Queue up
      ws.send(JSON.stringify({ type: "queue", timeControl: TC, stake: 0 }));
      break;

    case "game_start":
      gameId  = msg.gameId;
      myColor = msg.color;
      console.log(`[ts-engine] Game started: ${gameId} as ${myColor}`);
      break;

    case "your_turn": {
      if (!gameId) break;
      console.log(`[ts-engine] My turn — ply ${msg.ply}`);
      const pos   = parseFEN(msg.fen);
      const legal = legalMoves(pos);
      if (!legal.length) break;

      // Use engine search at chosen depth
      const candidates = bestCandidates(pos, DEPTH);
      const best = candidates[0];
      const uci  = best ? moveToUci(best.move) : moveToUci(legal[0]!);
      console.log(`[ts-engine] Playing ${uci} (depth ${DEPTH})`);
      ws.send(JSON.stringify({ type: "move", gameId, uci }));
      break;
    }

    case "move_ack":
      console.log(`[ts-engine] Move ack: ${msg.uci}`);
      break;

    case "move_rejected":
      console.error(`[ts-engine] Move rejected: ${msg.reason}`);
      // Fall back to random legal move
      break;

    case "opponent_move":
      console.log(`[ts-engine] Opponent played ${msg.uci} (ply ${msg.ply})`);
      break;

    case "game_end":
      console.log(`[ts-engine] Game ended: ${msg.result} by ${msg.reason}`);
      if (msg.ratingAfter) {
        console.log(`[ts-engine] Rating: μ=${msg.ratingAfter.mu.toFixed(2)} σ=${msg.ratingAfter.sigma.toFixed(2)}`);
      }
      ws.close();
      process.exit(0);
  }
});

ws.on("error", (e) => console.error("[ts-engine] WS error:", e.message));
ws.on("close", () => { console.log("[ts-engine] Disconnected"); process.exit(0); });
