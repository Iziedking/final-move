#!/usr/bin/env bun
/**
 * Final Move example agent — LLM agent.
 * Asks an OpenAI-compatible model for a move given FEN + legal moves.
 * Falls back to the vendored engine on invalid model output.
 *
 * Usage:
 *   export FINAL_MOVE_API_KEY=fmk_your_key_here
 *   export FINAL_MOVE_SERVER=http://localhost:3001
 *   export LLM_API_KEY=sk-...         # OpenAI or compatible
 *   export LLM_BASE_URL=https://api.openai.com/v1   # default
 *   export LLM_MODEL=gpt-4o-mini     # default
 *   bun examples/llm/agent.ts [--time-control 5+3]
 */
import { WebSocket } from "ws";
import { parseFEN, legalMoves, moveToUci, bestCandidates } from "@final-move/chess";
import type { ServerToAgent } from "@final-move/shared";

const SERVER  = (process.env.FINAL_MOVE_SERVER ?? "http://localhost:3001")
  .replace(/^http/, "ws");
const API_KEY = process.env.FINAL_MOVE_API_KEY ?? "";
const LLM_KEY = process.env.LLM_API_KEY ?? "";
const LLM_URL = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
const LLM_MDL = process.env.LLM_MODEL ?? "gpt-4o-mini";

const args = process.argv.slice(2);
const tcIdx = args.indexOf("--time-control");
const TC    = tcIdx !== -1 ? args[tcIdx + 1] : "5+3";

if (!API_KEY) { console.error("Set FINAL_MOVE_API_KEY"); process.exit(1); }
if (!LLM_KEY) { console.warn("[llm-agent] No LLM_API_KEY — will use engine fallback only"); }

async function askLlm(fen: string, legalUcis: string[]): Promise<string | null> {
  if (!LLM_KEY) return null;
  try {
    const resp = await fetch(`${LLM_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LLM_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model: LLM_MDL,
        messages: [
          {
            role:    "system",
            content: "You are a chess engine. Respond ONLY with one UCI move from the legal list. No explanations.",
          },
          {
            role:    "user",
            content: `FEN: ${fen}\nLegal moves: ${legalUcis.join(", ")}\nYour move:`,
          },
        ],
        max_tokens: 10,
        temperature: 0.2,
      }),
    });
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    const raw  = data.choices?.[0]?.message?.content?.trim() ?? "";
    // Validate the model's answer is in the legal list
    const uci  = raw.split(/\s+/)[0]?.toLowerCase() ?? "";
    return legalUcis.includes(uci) ? uci : null;
  } catch {
    return null;
  }
}

function engineFallback(fen: string): string {
  const pos   = parseFEN(fen);
  const legal = legalMoves(pos);
  const cands = bestCandidates(pos, 3);
  const best  = cands[0];
  return best ? moveToUci(best.move) : moveToUci(legal[0]!);
}

const ws = new WebSocket(`${SERVER}/v1/agent`, {
  headers: { Authorization: `Bearer ${API_KEY}` },
});

let gameId: string | null = null;

ws.on("open", () => console.log("[llm-agent] Connected"));

ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString()) as ServerToAgent;

  switch (msg.type) {
    case "hello":
      console.log(`[llm-agent] Hello as ${msg.name}`);
      ws.send(JSON.stringify({ type: "queue", timeControl: TC, stake: 0 }));
      break;

    case "game_start":
      gameId = msg.gameId;
      console.log(`[llm-agent] Game started: ${gameId} as ${msg.color}`);
      break;

    case "your_turn": {
      if (!gameId) break;
      const uciList = msg.moves.length ? msg.moves : [];
      if (!uciList.length) break;

      let uci = await askLlm(msg.fen, uciList);
      if (!uci) {
        console.log("[llm-agent] Model returned invalid/no move — using engine fallback");
        uci = engineFallback(msg.fen);
      }
      console.log(`[llm-agent] Playing ${uci} (ply ${msg.ply})`);
      ws.send(JSON.stringify({ type: "move", gameId, uci }));
      break;
    }

    case "game_end":
      console.log(`[llm-agent] Game ended: ${msg.result} by ${msg.reason}`);
      ws.close();
      process.exit(0);
  }
});

ws.on("error", (e) => console.error("[llm-agent] WS error:", e.message));
ws.on("close", () => process.exit(0));
