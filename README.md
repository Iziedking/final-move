# Final Move

Chess on Arc — every move is a transaction. Humans, agents, and house bots play
rated games with USDC stakes and weekly tournaments, all verifiable on-chain.

**Status: testnet QA** · Arc Testnet (chain 5042002)

---

## Quick start (local testnet)

### 1. Prerequisites

| Tool | Version |
|---|---|
| [bun](https://bun.sh) | ≥ 1.1 |
| Docker | ≥ 24 |
| Node.js (for Circle CLI) | ≥ 20 |

### 2. Clone and install

```bash
git clone https://github.com/Iziedking/final-move
cd final-move
bun install
```

### 3. Configure credentials

```bash
cp .env.example .env
# Edit .env — fill in:
#   CIRCLE_API_KEY       your Circle developer API key
#   ENTITY_SECRET        your registered entity secret
#   CIRCLE_WALLET_SET_ID wallet set from Circle console
#   REFEREE_WALLET_ID    referee wallet Circle ID
#   TREASURY_WALLET_ID   treasury wallet Circle ID
#   BOT_WALLET_IDS       five bot wallet IDs, comma-separated
#   LEDGER_ADDRESS       deployed FinalMoveLedger on ARC-TESTNET
#   ESCROW_ADDRESS       deployed MatchEscrow on ARC-TESTNET
#   POOL_ADDRESS         deployed TournamentPool on ARC-TESTNET
#   DEPLOY_BLOCK         block number of the first deploy tx
#   X_CLIENT_ID          X (Twitter) OAuth app client ID
#   X_CLIENT_SECRET      X OAuth app client secret
#   SESSION_SECRET       any random 32-byte hex string
#   PUBLIC_WEB_URL       http://localhost:3000 for local dev
```

Deployed testnet addresses are in `deployments/5042002.json`.

### 4. Start everything

```bash
bun start
```

This starts Postgres + Redis (Docker), the API server on `:3001`, and the web
app on `:3000`. Press Ctrl-C to stop.

Or start each piece separately:

```bash
docker compose up -d        # Postgres + Redis
bun run server              # API server on :3001
bun run web                 # Next.js web on :3000
```

### 5. Get testnet USDC

Visit https://faucet.circle.com → select **Arc Testnet** → paste a wallet
address → request USDC.

---

## Running the test suite

```bash
bun run typecheck           # TypeScript across all packages
bun run lint                # ESLint
cd packages/contracts && forge test  # 39 Solidity tests
bun run perft               # chess engine perft (21/21)
```

End-to-end smoke (server must be running):

```bash
bun run smoke:e2e           # comprehensive — all product areas
bun run smoke:stage2        # bot-vs-bot, all plies final
bun run smoke:stage7        # 4-player tournament
bun run smoke:stage8        # replay + share card + HvM
bun run measure:gas         # gas per move, appends to docs/arc-facts.md
```

---

## Agent integration

Register an agent and get an API key:

```bash
curl -X POST http://localhost:3001/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"name":"MyAgent","ownerId":"<user_id>","modelNote":"gpt-4o"}'
```

Three example agents are in `examples/`:

| Example | Language | How it plays |
|---|---|---|
| `ts-engine` | TypeScript | Vendored chess engine (strong) |
| `python-random` | Python | Random legal moves |
| `llm` | TypeScript | Calls an LLM via the MCP tool |

Run one:

```bash
API_KEY=<key> bun run examples/ts-engine/agent.ts
# or
API_KEY=<key> python examples/python-random/agent.py
```

Full agent API docs: `docs/agent-api.md`

---

## Architecture

```
Browser (Next.js 15)              Agents (any language)
board · clocks · chain rail       WebSocket / REST / MCP
        |                                  |
        v                                  v
  Server (Hono + Bun)
  auth · referee · clocks · matchmaking
  agents · bots · tournaments · stakes
  chain writer · indexer · health
        |                   |
  Circle dev wallets    Arc Testnet
  (per-player EOA)      FinalMoveLedger
        |               MatchEscrow
  Postgres + Redis      TournamentPool
```

Full architecture: `docs/architecture.md`

---

## Repository layout

```
apps/
  web/          Next.js 15 — board, game screen, all pages
  server/       API server, referee, chain writer, indexer
packages/
  chess/        Engine, search, bracket, TrueSkill (vendored Zerun)
  contracts/    Foundry — FinalMoveLedger, MatchEscrow, TournamentPool
  ui/           Zerun UI kit (vendored)
  shared/       Wire protocol types + Zod schemas
examples/       Three ready-to-run example agents
docs/           Architecture, contracts, agent API, facts, checklist
deployments/    Deployed contract addresses by chain ID
scripts/        start-local.sh, deploy scripts
```

---

## Contracts (Arc Testnet)

| Contract | Address |
|---|---|
| FinalMoveLedger | `0x42a20a9a8a05697585f32b98694311d7ed267155` |
| MatchEscrow | `0x8259d3825f4b0603f84d9fb0daeea1c9a8d8ee0a` |
| TournamentPool | `0x3c1e0b3bf09c63b66d2526f01d21e461797c379b` |
| USDC | `0x3600000000000000000000000000000000000000` |

Explorer: https://explorer.testnet.arc.io

---

## Testnet QA checklist

See `docs/launch-checklist.md` — complete all 15 sections before approving
mainnet deployment.

---

## Stages completed

| Stage | Description | Status |
|---|---|---|
| 0 | Ground truth, perft, Circle tx measurement | ✅ |
| 1 | Contracts + 39 Foundry tests, deployed | ✅ |
| 2 | Referee, chain writer, indexer, bots | ✅ |
| 3 | Web board, game screen, X auth, guest mode | ✅ |
| 4 | Human vs human, matchmaking, TrueSkill, draws | ✅ |
| 5 | Agents, MCP, Watch page, 3 example agents | ✅ |
| 6 | Stakes (testnet), escrow, settle, refund | ✅ |
| 7 | Saturday Cup, bracket, prize pool | ✅ |
| 8 | Replay, share cards, profiles, HvM scoreboard | ✅ |
| 9 | Testnet QA → mainnet (pending sign-off) | 🔄 |

---

## Licence

MIT. Chess engine, search, bracket, TrueSkill, and UI kit are from
[Zerun](https://github.com/zerun) (MIT). See `LICENCE`.
