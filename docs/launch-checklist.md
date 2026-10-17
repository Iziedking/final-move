# Final Move — Testnet Launch Checklist

Complete every item on this list before a public testnet launch.
Check each box as you go. If any item fails, fix it and re-check from that
section.

**QA status:** Round 3 complete (see AGENTS.md for per-item proof). Mainnet is on hold.

---

## Deployment topologies

See `docs/local-run.md` for full details.

**Topology A (single origin / reverse proxy) — recommended for production:**
- One domain. Reverse proxy routes `/v1/*`, `/ws`, `/mcp/*`, `/health` to the API
  server; everything else to Next.js.
- `NEXT_PUBLIC_API_ORIGIN` and `NEXT_PUBLIC_WS_URL` must be empty/unset.
- `API_ORIGIN` (server-side only) must point to the API server's internal address.

**Topology B (separate origin):**
- API server on its own domain (e.g. `api.finalmove.io`).
- Set `NEXT_PUBLIC_API_ORIGIN=https://api.finalmove.io` and
  `NEXT_PUBLIC_WS_URL=wss://api.finalmove.io`.
- API server must allow CORS from the web app's origin.

**Required env vars for a public testnet deploy:**
`CIRCLE_API_KEY`, `ENTITY_SECRET`, `ARC_RPC_URL`, `USDC_ADDRESS`, `LEDGER_ADDRESS`,
`ESCROW_ADDRESS`, `POOL_ADDRESS`, `REFEREE_WALLET_ID`, `TREASURY_WALLET_ID`,
`BOT_WALLET_IDS`, `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `AUTH_SECRET`,
`API_ORIGIN`, `PUBLIC_WEB_URL`.

**Blocking for public testnet launch:**
- [ ] `X_CLIENT_ID` / `X_CLIENT_SECRET` set in `apps/web/.env.local`
      (Sign in with X is currently non-functional without these)
- [ ] Referee wallet and bot wallets funded with testnet USDC for gas
- [ ] Database migration run: `bun run migrate` (applies migrations 001–008)
- [ ] E2E smoke passes: `bun run smoke:e2e`

---

## 0. Prerequisites

- [ ] `.env` populated from `.env.example` (all keys filled in)
- [ ] `docker compose up -d` — Postgres and Redis healthy
- [ ] `bun install` — no errors
- [ ] `bun run typecheck` — 0 errors across all packages
- [ ] `bun run lint` — 0 errors
- [ ] `forge test` (in `packages/contracts`) — 39/39 pass

---

## 1. Server starts clean

```bash
./scripts/start-local.sh
```

- [ ] Server prints `[server] ready on :3001`
- [ ] `curl http://localhost:3001/health` → `ok:true, db:ok, redis:ok`
- [ ] `indexer.lagBlocks` is decreasing (catches up within a few minutes)
- [ ] `treasury.balanceUsdc6` > 0

---

## 2. Web app loads

Open `http://localhost:3000` in a browser.

- [ ] Home page loads without console errors
- [ ] "Connect with X" button visible (or guest play available)
- [ ] Play modal opens on "Play" click
- [ ] Bot difficulty and time control selectable
- [ ] Leaderboard page loads at `/leaderboard`
- [ ] Watch page loads at `/watch`
- [ ] Saturday Cup page loads at `/cup`
- [ ] About page loads at `/about`
- [ ] Wallet page loads at `/wallet`
- [ ] Agents page loads at `/agents`

---

## 3. Guest vs bot game (no sign-in)

- [ ] Select bot level 1, time control 3+2, start as guest
- [ ] Board renders at correct orientation
- [ ] Legal move dots appear on tap/click
- [ ] Move plays, opponent responds within 1s
- [ ] Clock counts down correctly
- [ ] Chain rail shows moves progressing: queued → submitted → complete → final
- [ ] Explorer link appears in chain rail and opens correctly
- [ ] Game ends (win/loss/draw) — end screen shows result
- [ ] End screen has "Share" button and explorer link for the game

---

## 4. Sign in with X and rated play

- [ ] "Connect with X" opens OAuth flow
- [ ] After sign-in, handle and avatar appear in nav
- [ ] Wallet address shown in wallet page
- [ ] Wallet has USDC (get from sidebar "Get test USDC" or faucet)
- [ ] Play a rated game vs bot — rating updates after game ends
- [ ] Rating appears on leaderboard

---

## 5. Human vs human matchmaking

Use two browser tabs or two different users.

- [ ] Player A clicks "Find Match" (5+3 Open)
- [ ] Player B clicks "Find Match" (5+3 Open) in a second tab
- [ ] Both match within 30 seconds
- [ ] Game starts on both boards simultaneously
- [ ] Moves appear on both boards in real time
- [ ] Draw offer workflow works (offer → accept → draw result)
- [ ] Resign works
- [ ] Rematch offer appears after game ends

---

## 6. Agent game

```bash
# Register an agent
curl -X POST http://localhost:3001/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"name":"TestAgent","ownerId":"<your_user_id>","modelNote":"test"}'

# Note the apiKey from the response, then run the example agent:
API_KEY=<key> bun run examples/ts-engine/agent.ts
```

- [ ] Agent registers and gets an API key
- [ ] Example TS engine agent connects and queues
- [ ] Agent vs bot game completes
- [ ] Game visible on Watch page at `/watch`
- [ ] Replay works for the agent game
- [ ] MCP endpoint responds: `curl -X POST http://localhost:3001/mcp -H "Authorization: Bearer <key>" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`

---

## 7. Saturday Cup tournament

- [ ] Create a tournament via the `/cup` page or API
- [ ] Register 4+ participants (bots or agents)
- [ ] Start the tournament
- [ ] Bracket advances round by round
- [ ] Champion displayed on Cup page after completion
- [ ] `status=done` in API response
- [ ] Standings show placements 1, 2, 3

---

## 8. Stakes (testnet USDC)

- [ ] Fund two player wallets from testnet faucet
- [ ] Create a staked game (1 USDC stake)
- [ ] Both wallets approve and deposit
- [ ] Game plays — winner receives 2 USDC (minus gas)
- [ ] Draw test: create staked game, force draw — both wallets refunded
- [ ] Unfunded test: only one player deposits — that player refunded on cancel

---

## 9. Replay and share cards

- [ ] Navigate to a finished game via `/g/<gameId>`
- [ ] Replay page loads and shows move-by-move replay
- [ ] Each ply in the chain rail links to the explorer
- [ ] Move sequence in replay matches the game record
- [ ] Share card endpoint returns correct data: `GET /v1/games/<id>/share`
- [ ] X share text includes game ID and result

---

## 10. Chain verification

Pick a finished game and verify it independently:

```bash
# Get the game's chain_game_id from the API
curl http://localhost:3001/v1/games/<gameId>/replay | jq .game.chainGameId

# Look it up on the explorer
open https://explorer.testnet.arc.io/address/<LEDGER_ADDRESS>
```

- [ ] `GameCreated` event visible on explorer for the game
- [ ] `Move` events count matches the ply count in the DB
- [ ] `GameEnded` event visible with correct result
- [ ] Move sequence from chain events matches server record move-for-move

---

## 11. Gas measurement

```bash
bun run apps/server/scripts/measure-gas.ts
```

- [ ] Script completes without error
- [ ] Gas per move (median) recorded in `docs/arc-facts.md`
- [ ] Total game cost for an 80-ply game is < $0.15 USDC
- [ ] Treasury float sized correctly: `TOPUP_AMOUNT_USDC` and `TOPUP_DAILY_CAP_USDC` set

---

## 12. E2E automated smoke

```bash
bun run apps/server/scripts/e2e-smoke.ts
```

- [ ] **All checks pass (0 failed)**
- [ ] Indexer lag < 500 blocks

---

## 13. Security review

- [ ] `.env` is in `.gitignore` — confirm `git status` does not show it
- [ ] `CIRCLE_API_KEY` and `ENTITY_SECRET` are NOT in any committed file
- [ ] `recovery_file.dat` is outside the repo and backed up
- [ ] Agent API keys shown once, stored hashed (check `agents` table: no plaintext keys)
- [ ] Webhook signatures verified — test with a tampered payload, confirm 401
- [ ] Stakes UI shows no "Mainnet" or real-money language anywhere
- [ ] About page has correct testnet disclaimer

---

## 14. Performance baseline

- [ ] Board renders and accepts a move in < 100ms (check browser DevTools)
- [ ] WebSocket move RTT (click to opponent sees move) < 200ms on localhost
- [ ] Server startup time < 5s
- [ ] Indexer catches up from deploy block to head in < 5 minutes (count on fresh DB)

---

## 15. Sign-off

Once all boxes above are checked:

| Item | Owner | Date |
|---|---|---|
| All 15 sections pass | | |
| Gas numbers in arc-facts.md | | |
| E2E smoke 0 failures | | |
| Security review complete | | |
| **Testnet sign-off** | | |

After sign-off, proceed to mainnet deployment using `scripts/deploy-mainnet.sh`
(created in Stage 9b, after this sign-off).

---

## Notes

- Testnet USDC faucet: https://faucet.circle.com (select Arc Testnet)
- Testnet explorer: https://explorer.testnet.arc.io
- Arc testnet chain ID: 5042002
- Contracts: see `deployments/5042002.json`
