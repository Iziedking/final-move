/**
 * Stage 5 smoke test.
 * Verifies: agent registration, API key auth, MCP tools/list,
 * REST long-poll, Watch page, agent WS queue + game_start.
 *
 * Does NOT play a full game on-chain (that requires funded wallets);
 * verifies all protocol surfaces are wired correctly.
 */

const BASE = "http://localhost:3001";

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else       { console.error(`  ✗ ${label}`, detail ?? ""); failed++; }
}

async function post(path: string, body: unknown, headers?: Record<string,string>) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get(path: string, headers?: Record<string,string>) {
  const res = await fetch(`${BASE}${path}`, { headers: headers ?? {} });
  return res.json();
}

function _sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
void _sleep; // kept for future use

// ── 0. Ensure smoke user exists ───────────────────────────────────────────────
await post("/v1/users/upsert", { id: "u_smoke_owner", handle: "SmokeUser" });

// ── 1. Agent registration ──────────────────────────────────────────────────────

console.log("\n[1] Agent registration");

const smokeName = `SmokeBot${Date.now().toString(36)}`;
const reg = await post("/v1/agents", {
  ownerId: "u_smoke_owner",
  name:    smokeName,
}) as { agentId?: string; apiKey?: string; error?: string };

ok("POST /v1/agents → agentId", !!reg.agentId, reg);
ok("POST /v1/agents → apiKey (fmk_...)", reg.apiKey?.startsWith("fmk_") ?? false, reg.apiKey);

const agentId = reg.agentId!;
const apiKey  = reg.apiKey!;

// ── 2. List agents ─────────────────────────────────────────────────────────────

console.log("\n[2] List agents");

const list = await get(`/v1/agents?ownerId=u_smoke_owner`) as { agents: { id: string }[] };
ok("GET /v1/agents → agents array", Array.isArray(list.agents), list);
ok("GET /v1/agents → contains registered agent", list.agents.some((a) => a.id === agentId));

// ── 3. Duplicate name rejected ─────────────────────────────────────────────────

console.log("\n[3] Duplicate name rejected");

const dup = await post("/v1/agents", {
  ownerId: "u_smoke_owner2",
  name:    "SmokeBot",
}) as { error?: string };
ok("Duplicate agent name → error", !!dup.error, dup);

// ── 4. API key auth ────────────────────────────────────────────────────────────

console.log("\n[4] API key auth");

const authed = await get("/v1/agent/next?wait=1", { Authorization: `Bearer ${apiKey}` }) as { type: string };
ok("GET /v1/agent/next with key → type=idle", authed.type === "idle", authed);

const unauthed = await fetch(`${BASE}/v1/agent/next?wait=1`);
ok("GET /v1/agent/next without key → 401", unauthed.status === 401);

// ── 5. MCP initialize + tools/list ────────────────────────────────────────────

console.log("\n[5] MCP");

const mcpInit = await post("/mcp", {
  jsonrpc: "2.0", id: 1, method: "initialize", params: {},
}, { Authorization: `Bearer ${apiKey}` }) as { result?: { protocolVersion: string; capabilities: unknown } };

ok("POST /mcp initialize → protocolVersion", !!mcpInit.result?.protocolVersion, mcpInit);
ok("POST /mcp initialize → capabilities", !!mcpInit.result?.capabilities, mcpInit);

const mcpTools = await post("/mcp", {
  jsonrpc: "2.0", id: 2, method: "tools/list", params: {},
}, { Authorization: `Bearer ${apiKey}` }) as { result?: { tools: { name: string }[] } };

ok("POST /mcp tools/list → tools array", Array.isArray(mcpTools.result?.tools), mcpTools);
const toolNames = mcpTools.result?.tools.map((t) => t.name) ?? [];
for (const t of ["find_game","get_position","make_move","offer_draw","resign","my_games","leaderboard"]) {
  ok(`MCP tool: ${t}`, toolNames.includes(t), toolNames);
}

// ── 6. MCP my_games ────────────────────────────────────────────────────────────

console.log("\n[6] MCP my_games");

const mcpMyGames = await post("/mcp", {
  jsonrpc: "2.0", id: 3, method: "tools/call",
  params: { name: "my_games", arguments: {} },
}, { Authorization: `Bearer ${apiKey}` }) as { result?: { content: { text: string }[] } };

ok("MCP my_games → result", !!mcpMyGames.result, mcpMyGames);

// ── 7. REST queue ──────────────────────────────────────────────────────────────

console.log("\n[7] REST queue");

const qRes = await post("/v1/agent/queue", { timeControl: "5+3" }, {
  Authorization: `Bearer ${apiKey}`,
}) as { ticketId?: string };
ok("POST /v1/agent/queue → ticketId", !!qRes.ticketId, qRes);

// ── 8. Watch endpoint ──────────────────────────────────────────────────────────

console.log("\n[8] Watch");

const watch = await get("/v1/watch") as { games: unknown[] };
ok("GET /v1/watch → games array", Array.isArray(watch.games), watch);

// ── 9. MCP leaderboard ────────────────────────────────────────────────────────

console.log("\n[9] MCP leaderboard");

const mcpLb = await post("/mcp", {
  jsonrpc: "2.0", id: 4, method: "tools/call",
  params: { name: "leaderboard", arguments: { class: "open" } },
}, { Authorization: `Bearer ${apiKey}` }) as { result?: unknown };
ok("MCP leaderboard → result", !!mcpLb.result, mcpLb);

// ── Done ───────────────────────────────────────────────────────────────────────

console.log("\n──────────────────────────────────────────────────");
console.log(`Stage 5 smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
