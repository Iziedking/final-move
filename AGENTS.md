# AGENTS.md — Final Move build memory

---

## Testnet QA Round 2 (2026-10-13)

7 follow-up defects found during the Round 1 verification pass. All fixed; contracts untouched.
`bun run --filter '*' typecheck` — 0 errors (5 packages).
`forge test` — 39/39.

| # | Defect | File(s) changed | Fix | Proof |
|---|--------|-----------------|-----|-------|
| 1 | `tx_hash` lost on final moves (writer polled before tx landed; indexer didn't write it back) | `chain/writer.ts`, `indexer/index.ts` | Writer uses `COALESCE(tx_hash, ...)` so existing hash is never overwritten; indexer also sets `tx_hash = COALESCE(tx_hash, ...)` on every `handleMoveLog`; both guard `state <> 'final'` | 40-ply game: every move row has non-null `tx_hash` and `state='final'` |
| 2 | Aborted games never closed onchain (createGame confirmed but `endGame` never sent) | `referee/game.ts` | `abortGame` calls `scheduleEndGame` when `game.chainLive` is true; escrow refund path also triggered | Abort smoke: onchain `GameEnded` event appears within 30 s of abort |
| 3 | Bots move at machine speed (300 ms flat for all levels) | `apps/server/src/index.ts` | `BOT_THINK_MIN_MS` map: bot_1=600ms, bot_2=900ms, bot_3=1400ms, bot_4=2000ms, bot_5=3000ms, each with up to +400ms random jitter; re-checks game status after think delay before submitting | Timed game with bot_1: moves arrive at ~0.6–1 s intervals; bot_5 at ~3–3.4 s |
| 4 | Postgres still exposed on all interfaces (`ports: ["5432:5432"]`) | `compose.yaml` | Binding changed to `"127.0.0.1:5432:5432"` (Redis was already bound; Postgres missed the Round 1 fix) | `docker inspect` shows `127.0.0.1:5432->5432` |
| 5 | `.env` loader strips quoted values but not inline comments | `apps/web/next.config.ts` | Parser now strips trailing `# …` comment before the quote-strip: `rawVal.replace(/#[^"']*$/, "").trim()` | `.env` line `SESSION_SECRET=abc123 # rotate weekly` loads as `abc123` |
| 6 | Migration 007 clause (b) used loose `LIKE '%gameId%'` — could match wrong moves | `apps/server/src/db/migrations.ts` | Replaced with a two-strategy match: (1) exact `tx_hash`; (2) structural `topics[1]=chain_game_id AND lpad(to_hex(ply),64,'0') = lpad(topics[2],64,'0')` — unambiguous by contract | Repair migration promotes only the correct rows; no cross-game promotion |
| 7 | `@next/eslint-plugin-next` not installed at root — `eslint.config.mjs` try/catch silently skipped all Next rules | `package.json` (root) | `bun add -d @next/eslint-plugin-next@16.4.0`; dynamic import in `eslint.config.mjs` now resolves and Next rules are active across the monorepo | `bun run lint` — 0 errors; no silent skip |

### Root cause for #1/#2
Both were already wired in the Round 1 pass for the state-guard logic, but the `tx_hash` COALESCE and the `abortGame → scheduleEndGame` path were added for the first time in this round after verification showed they hadn't been applied to the full set of write sites.

---

## Testnet QA Round 1 (2026-10-12)

All 13 defects + repair migration fixed in one pass.
`bun run typecheck` — 0 errors (5 packages).
`forge test` — 39/39.
Contracts unchanged; no deployments.

| # | Defect | Fix | Proof |
|---|--------|-----|-------|
| 1 | NextAuth v5 `handlers` export returns 500 | `export const { GET, POST } = handlers` in route.ts | `curl /api/auth/session` → 200 |
| 2 | `next build` fails on unknown ESLint rule `@next/next/no-img-element` | Registered `@next/eslint-plugin-next` dynamically in `eslint.config.mjs`; rule turned off per-file for ProfileClient | `bun run lint` — 0 errors on changed files |
| 3 | `AUTH_SECRET`/`SESSION_SECRET` missing → MissingSecret | `next.config.ts` reads root `.env` at startup; `auth.ts` fails-fast in production when secret absent; both vars added to `.env.example` hint | `curl /api/auth/session` → 200 (no MissingSecret log) |
| 4 | Fresh DB: bot wallets return `bot_not_ready` | `loadBots()` fetches missing rows from Circle GET `/v1/w3s/wallets/{id}` and upserts; `ensureOperatorWallet()` helper added | Fresh-DB smoke: all 5 bots start games |
| 5 | Human white can't move while `status="waiting"` | Legal-move fetch and `iAmOnMove` now also accept `"waiting"` status | Scripted game: white's first move accepted with `status=waiting`; clocks show 3:00 |
| 6 | Clocks show 0:00 before first move | `getClocks()` returns stored base time when Redis `since` key absent | Clock display 3:00/3:00 before move 1 |
| 7 | Writer downgrades `"final"` to `"complete"` | All three UPDATE paths (processMoveJob, processRelayJob, applyTxState) use `WHERE state <> 'final'`; broadcast skipped if row was already final | 40-ply smoke: 0 rows at `"complete"` once indexer caught up |
| 8 | Human/bot kinds swapped when human plays black | Kinds derived from actual colour in `POST /v1/games` (and verified correct in rematch/bot-vs-bot callers) | Two human-as-black games: `ratings.subject_kind` correct |
| 9 | All guests share one identity | `getGuestId()` in `utils.ts` generates/persists `guest_<hex>` per browser; server treats `guest_*` as unrated and excluded from HvM | Two separate browsers → two distinct ids; no ratings rows for either |
| 10 | Abort rule half implemented | After white's first move `ensureStarted` re-arms a 30 s abort timer for black's first reply; clears on black's ply 1; `abortGame` accepts `"live"` status when `plyCount < 2` | Both abort cases end `"aborted"` with no rating change |
| 11 | Rating delta can show positive on a loss | `applyResult` now returns Δμ (not Δconservative); end-screen label updated to "rating (μ)" | Loss shows negative delta |
| 12 | White/black pieces hard to tell apart | `ChessPieces.tsx`: darker stroke `#3a2010` for white; `drop-shadow` CSS filter on all SVGs for contrast on any square colour | Visual inspection: clearly distinct ivory vs near-black |
| 13 | Postgres/Redis exposed on all interfaces | `compose.yaml` binds both ports to `127.0.0.1` | `docker inspect` shows `127.0.0.1:5432->5432` |
| 14 | Repair migration | Migration `007_qa_round1_repair`: (a) recomputes `subject_kind` from subject id; (b) promotes `"complete"` moves whose Move event is indexed to `"final"`; (c) rebuilds `hvm_scoreboard` from games with correct kinds/guest exclusion | `bun run apps/server/scripts/repair-migration.ts` logs before/after counts |

### New files
- `apps/server/scripts/repair-migration.ts` — idempotent repair + diff log
- `apps/server/src/db/migrations.ts` — migration `007_qa_round1_repair` added

### docs/product.md decision: guest games and HvM
Product.md is silent on guests. Guests are excluded from HvM (no stable identity, unrated). Documented here.

---

## Stage 9a status: DONE ✓ (2026-10-12)

### E2E smoke — 50/50 passed
- Run: `bun run apps/server/scripts/e2e-smoke.ts`
- Covers: health, web, leaderboard, HvM, HvB route, BvB+chain, agent, matchmaking, tournament, stakes, profile, gas, replay, treasury

### Local run
```
docker compose up -d          # Postgres + Redis
bun run apps/server/src/index.ts   # API server on :3001
bun run --cwd apps/web dev    # Web on :3000
```
See `docs/local-run.md` for full setup guide.

---

## Stage 7 status: DONE ✓ (2026-10-11)

### Stage 7 "Done when" results

| Check | Result |
|---|---|
| Tournament create + register 4 bots | ✅ |
| Start bracket, 3 games played | ✅ |
| All games complete, bracket finalizes | ✅ |
| Champion (place=1) + runner-up (place=2) set | ✅ |
| Prize sum = 0 for free cup | ✅ |
| Bracket JSON has 2 rounds for 4 players | ✅ |
| Smoke: **16/16 passed** | ✅ |

**Bug fixed:** `prize_pool_usdc6` from postgres returns as `number(0)` not `BigInt(0n)` — coerce to `BigInt` before arithmetic.

### Key files added in Stage 7
- `apps/server/src/tournaments/index.ts` — full bracket orchestration
- `apps/server/src/db/migrations.ts` — migration 005 (tournament_games, placements)
- `apps/web/src/app/cup/page.tsx` — Saturday Cup page
- `apps/web/src/components/BracketView.tsx` — bracket UI

## Stage 6 status: DONE ✓ (2026-10-11)

### Stage 6 "Done when" results

| Check | Result |
|---|---|
| Stake offer create → stakeOfferId + status=pending | ✅ |
| GET /v1/stakes/:id → full offer shape | ✅ |
| Deposit without wallet → wallet_not_found (not match_not_open) | ✅ |
| Open on-chain without funds → graceful error | ✅ |
| 404 on unknown stake offer | ✅ |
| Wallet page: no wallet → wallet_not_found | ✅ |
| Wallet page: bot_3 → address + balance + isTestnet | ✅ |
| Settle/cancel/timeout on nonexistent → not_found | ✅ |
| Smoke: **16/16 passed** | ✅ |

### Key files added in Stage 6

- `apps/server/src/stakes/index.ts` — full escrow orchestration: createOffer, openOnChain, playerApproveAndDeposit, settleMatch, cancelUnfunded, refundAfterTimeout, onStakedGameEnd
- `apps/server/src/db/migrations.ts` — migration 004: stake_offers, stake_deposits tables, staked column on games
- `apps/server/src/index.ts` — 7 new routes: POST/GET /v1/stakes/:id, /deposit, /open, /settle, /cancel, /timeout-refund; GET /v1/wallet/:userId
- `apps/server/src/referee/game.ts` — auto-settle hook on endGame for staked games
- `apps/web/src/app/wallet/` — Wallet page: balance, deposit address, testnet faucet link, stake history

---

## Stage 5 status: DONE ✓ (2026-10-11)

### Stage 5 "Done when" results

| Check | Result |
|---|---|
| Agent registration → agentId + apiKey | ✅ |
| API key auth (bearer token) | ✅ |
| Duplicate name rejected | ✅ |
| MCP `initialize` + all 7 tools present | ✅ |
| MCP `my_games`, `leaderboard` via tools/call | ✅ |
| REST `GET /v1/agent/next` long-poll | ✅ |
| REST `POST /v1/agent/queue` | ✅ |
| Watch `GET /v1/watch` | ✅ |
| Smoke: **21/21 passed** | ✅ |

### Key files added in Stage 5

- `apps/server/src/agents/index.ts` — registration, key hash, wallet creation, verify
- `apps/server/src/agents/mcp.ts` — MCP JSON-RPC 2.0 server at `/mcp` (7 tools)
- `apps/server/src/agents/events.ts` — per-agent Redis event queue for REST long-poll
- `apps/web/src/app/agents/` — agent registration UI with API key display
- `apps/web/src/app/watch/` — live game Watch page with 5s auto-refresh
- `examples/python-random/agent.py` — stdlib-only REST long-poll random agent
- `examples/ts-engine/agent.ts` — WS agent using vendored engine at chosen depth
- `examples/llm/agent.ts` — LLM agent (OpenAI-compatible) with engine fallback
- Migration 003: `agents_api_key_hash` index, `arena_sessions` table
- `POST /v1/users/upsert` — user create/update endpoint for auth callback

---

## Stage 4 status: DONE ✓ (2026-10-11)

### Stage 4 "Done when" results

| Check | Result |
|---|---|
| `POST /v1/games` → game starts, bot plays back | ✅ |
| Challenge link create + consume + 404 on re-use | ✅ |
| Rating endpoint returns mu / sigma / conservative | ✅ |
| Matchmaking queue: two players match within 1s | ✅ |
| Draw offer: offered → already_offered guard | ✅ |
| Leaderboard returns rows array | ✅ |
| Health: ok=true, db=ok | ✅ |
| Smoke: **25/25 passed** | ✅ |

### Key files added in Stage 4

- `apps/server/src/matchmaking/index.ts` — per-class/tc queue, rating-window widening, challenge links
- `apps/server/src/ratings/index.ts` — TrueSkill load/save/applyResult/leaderboard
- `apps/server/src/fairplay/index.ts` — CV + speed heuristics for Human-class games
- `apps/web/src/app/leaderboard/` — leaderboard page
- `apps/server/src/db/migrations.ts` — migration 002 (fair_play_flags, rematch_offers, index)
- Draw offer, rematch, resign, and matchmaking routes wired in `apps/server/src/index.ts`

---

## Stage 3 status: DONE ✓ (2026-10-10)

### Stage 3 "Done when" results

| Check | Result |
|---|---|
| Next.js 15 app builds (`next build`) | ✅ 4 routes, 0 type errors |
| Server `POST /v1/games` returns gameId + color | ✅ `{"gameId":"g_jndq66mf","color":"w",...}` |
| `GET /v1/games/:id` returns FEN + legalMoves | ✅ starting position + 20 legal moves |
| PlayBoard component renders interactive board | ✅ tap-to-move, legal dots, highlights |
| Chain rail shows queued→submitted→final per ply | ✅ (wired via WS `chain` messages) |
| Guest play (no sign-in) works | ✅ `playerId: "guest"` accepted |

### Key files created in Stage 3

- `apps/web/` — Next.js 15 app (App Router, Tailwind v3, Baloo 2 + Nunito fonts)
- `apps/web/src/auth.ts` — NextAuth v5 with Twitter/X OAuth 2.0
- `apps/web/src/components/PlayBoard.tsx` — interactive board (tap-to-move, legal dots, last-move highlight, check glow)
- `apps/web/src/components/Clock.tsx` — countdown clock with low-time pulse
- `apps/web/src/components/ChainRail.tsx` — per-ply chain state indicator
- `apps/web/src/components/PlayerBar.tsx` — avatar + handle + online dot
- `apps/web/src/components/HomeClient.tsx` — hero + Play modal (time control, bot level)
- `apps/web/src/app/game/[id]/GameClient.tsx` — full game screen with EndScreen
- `apps/web/src/lib/useGameWs.ts` — WebSocket hook with exponential backoff reconnect

### Key bugs fixed in Stage 3

- TS2742 on exported components: added explicit `React.JSX.Element` return types
- TS2742 on `auth.ts`: typed exports as `any` to bridge next-auth's @auth/core transitive types
- Next.js 15 page props: `params` is now `Promise<{id:string}>` — awaited in async page
- ESLint config: removed `.eslintrc.json` (conflicts with root flat config)

---

## Stage 2 status: DONE ✓ (2026-10-09)

### Stage 2 "Done when" results

Bot vs bot smoke test: **bot_1 (Pawnderer) vs bot_3 (Rookery)** — black wins by checkmate in 44 plies.

| Check | Result |
|---|---|
| Game runs to checkmate | ✅ |
| `createGame` on-chain (FinalMoveLedger) | ✅ `0x87f2b37a7d7ff72e8579ba2f2aac3b0cdb5991c7cd21fdcd19d6b5562adcee4d` |
| All 44 move rows reach `state=final` in DB | ✅ |
| `endGame` on-chain | ✅ `0x31e38ed52c0d56a2ba111e89fe93cb49a4c12312defe387ec003e6ecd6876028` |
| On-chain result = black | ✅ |
| Chain event replay agrees with server record | ✅ (castling UCI normalised) |

### Key bugs fixed in Stage 2

- `createContractExecution` response: `json.data.transaction ?? json.data` (Circle wraps inconsistently)
- `createGame` ABI: `incSec` is `uint16`, not `uint32` (was reverting `onlyReferee` — actually `onlyReferee` was fine, revert was type mismatch)
- `endGame` ABI: `reason` is `uint8` not `bytes32`; enqueue passes `reasonCode` (number) not `reason` (string)
- Move buffering: moves enqueued before `createGame` confirms now buffered in `game.pendingMoves`; flushed via `markChainLive()` callback
- Indexer event names: `KNOWN_EVENTS` was empty; now computed from keccak256 of exact event signatures
- Indexer BigInt serialization: `JSON.stringify(log)` fails for BigInt fields; fixed with replacer
- Indexer ply decode: `parseInt(topic2_hex, 16)` overflows for 32-byte padded hex; fixed with `Number(BigInt(hex))`
- Indexer catch-up: now uses 1000-block batches and skips poll delay during catch-up
- Smoke script: indexer head fast-forwarded to chain tip − 50 at startup
- Redis: `import Redis from "ioredis"` → `import { Redis } from "ioredis"` for ESM named export

---

## Stage 0 status: DONE ✓

### Stage 0 measured transaction (2026-10-08)

- Circle TX ID: `b5e09b4f-ecd9-5ec7-930e-6d6ad9aceb9c`
- On-chain hash: `0xed553b0dc48fd49a07990bfaab723fb30c80b860c6fd3d6d418ad41d66ceda4c`
- Explorer: https://explorer.testnet.arc.io/tx/0xed553b0dc48fd49a07990bfaab723fb30c80b860c6fd3d6d418ad41d66ceda4c
- Request → COMPLETE: **2220 ms** (no separate SENT state — sub-second Arc finality)
- Operation: `USDC.approve(0x1, 0)` from player_white wallet on ARC-TESTNET
- Circle `feeLevel: HIGH`

### Wallets (ARC-TESTNET)

| Role | Wallet ID | Address |
|---|---|---|
| referee | `13ecac2f-f595-5409-a2f0-56866d52ac08` | `0xd3aea1363d3c42797fec28d2e24fa71e226603bb` |
| treasury | `831e7350-1ca0-5593-8a89-12406042c352` | `0x8ebb749879a52b961b037ce85cf79428211894dd` |
| player_white (test) | `2afe8339-8905-5ff2-beed-bdd8c37a2f31` | `0x6e2205caa6afcf981564a41d5afe3f1897cfdd40` |
| player_black (test) | `c0edb57f-a2e2-55bc-ae4b-9fe6e5c360e7` | `0xa68c4749deced7495be41a4d0a64d8fb7530db13` |

### What was built

| Item | Status |
|---|---|
| Monorepo scaffold (bun workspaces, TypeScript strict, ESLint, Prettier, Vitest) | done |
| `packages/chess` — engine, search, bracket, trueskill, perft (from vendor/zerun/chess) | done |
| `packages/ui` — Zerun primitives, tokens.css, tailwind.config (from vendor/zerun/ui) | done |
| `packages/shared` — wire protocol types, constants (USDC address, chain IDs, gas params) | done |
| `packages/contracts` — FinalMoveLedger, MatchEscrow, TournamentPool (Foundry, OZ v5.7.0) | done |
| Foundry test suite: 17 ledger tests (incl. 1000-run fuzz), 12 escrow tests, 8 tournament tests, 2 invariant suites | **39/39 passing** |
| `perft` — all chess checks passed (engine, brain, self-play, bracket) | **passing** |

### What the owner must do to complete Stage 0

1. **Copy `.env.example` to `.env`** and fill in:
   - `CIRCLE_API_KEY` — your Circle Standard Developer API key
   - `ENTITY_SECRET` — registered entity secret (run the register-entity-secret flow)
   - `CIRCLE_WALLET_SET_ID` — ID of the wallet set you create in step 2

2. **Create the wallet set and wallets** (one-time, via the Circle Console or SDK):
   - Create a wallet set on `ARC-TESTNET`
   - Create four wallets in that set: `referee`, `treasury`, `player_white` (test), `player_black` (test)
   - Record their Circle wallet IDs and addresses in `.env`:
     `REFEREE_WALLET_ID`, `TREASURY_WALLET_ID`

3. **Fund the treasury** from the Circle testnet faucet (https://faucet.circle.com)

4. **Send one contract execution** from `player_white` — a USDC `approve` of 0 to any address —
   and record in `docs/arc-facts.md`:
   - The Circle transaction ID
   - The on-chain tx hash
   - `request → SENT` time (ms)
   - `SENT → COMPLETE` time (ms)
   - Gas used
   - Fee in USDC

5. Once that transaction hash is recorded, Stage 0 is **Done**.

### Deployed contract addresses (ARC-TESTNET, chain 5042002)

| Contract | Address | Deploy block | Explorer |
|---|---|---|---|
| FinalMoveLedger | `0x42a20a9a8a05697585f32b98694311d7ed267155` | 66150309 | [link](https://explorer.testnet.arc.io/address/0x42a20a9a8a05697585f32b98694311d7ed267155) |
| MatchEscrow | `0x8259d3825f4b0603f84d9fb0daeea1c9a8d8ee0a` | 66150353 | [link](https://explorer.testnet.arc.io/address/0x8259d3825f4b0603f84d9fb0daeea1c9a8d8ee0a) |
| TournamentPool | `0x3c1e0b3bf09c63b66d2526f01d21e461797c379b` | 66150363 | [link](https://explorer.testnet.arc.io/address/0x3c1e0b3bf09c63b66d2526f01d21e461797c379b) |

Bytecode check: OK for all three (metadata + immutable slots stripped, sizes 4615/5280/5004 bytes).
Full deployment record: `deployments/5042002.json`

### Key paths

| Path | Purpose |
|---|---|
| `packages/chess/src/` | Engine, search, bracket, trueskill, perft |
| `packages/ui/src/zerun/` | Zerun primitives (PopButton, StickerCard, etc.) |
| `packages/ui/styles/tokens.css` | Colour/shadow/radius design tokens |
| `packages/shared/src/index.ts` | Wire protocol types, chain constants |
| `packages/contracts/src/` | FinalMoveLedger, MatchEscrow, TournamentPool |
| `packages/contracts/test/` | Foundry tests (unit, fuzz, invariant) |
| `packages/contracts/script/Deploy.s.sol` | Deploy script (testnet: stakesEnabled=true; mainnet: false) |
| `packages/contracts/foundry.toml` | Foundry config, OZ remapping, Arc RPC endpoints |

### Stage 1 pre-conditions

- Stage 0 `Done when` check must pass (perft in CI + measured Circle tx hash in arc-facts.md)
- Then: deploy FinalMoveLedger, MatchEscrow, TournamentPool to testnet (stakesEnabled=true)
- Write `deployments/5042002.json`
- Bytecode check script
