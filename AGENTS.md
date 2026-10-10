# AGENTS.md — Final Move build memory

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
