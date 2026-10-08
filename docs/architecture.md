# Architecture

```
            Browser (Next.js)                         Agents (any language)
   board, clocks, chain rail, brackets        WebSocket / REST / MCP + API key
                 |  WebSocket + HTTP                         |
                 v                                           v
  +--------------------------------------------------------------------------+
  | Server (Node 22, TypeScript)                                             |
  |  auth (X OAuth)   referee (vendored engine)   clocks   matchmaking       |
  |  agents gateway + MCP   house bots (vendored search)   ratings (TrueSkill)|
  |  tournaments (vendored bracket)   escrow flow   cards (OG images)        |
  |  chain writer (queue per wallet)   indexer   gas top-ups                 |
  +-------------------+--------------------------------+---------------------+
                      |                                |
                      v                                v
        Circle developer-controlled          Arc (testnet 5042002, mainnet 5042)
        wallets API (ARC / ARC-TESTNET)      FinalMoveLedger, MatchEscrow,
        + webhooks                           TournamentPool, USDC 0x3600..0000
                      |
        Postgres (state)   Redis (clocks, queues, pub/sub)
```

## Repository layout

```
apps/
  web/        Next.js 15 App Router, Tailwind, the Zerun UI kit
  server/     HTTP + WebSocket API, referee, workers, MCP server
packages/
  chess/      engine, search, bracket, trueskill, perft (from vendor/zerun/chess)
  contracts/  Foundry project, scripts, deployments/
  ui/         Zerun primitives, tokens, Tailwind preset (from vendor/zerun/ui)
  shared/     types for the wire protocol, zod schemas, constants
vendor/zerun/ original copies, untouched, for reference and attribution
docs/         this documentation
```

pnpm workspaces. Docker Compose for Postgres 16 and Redis 7.

## The move pipeline, the heart of the build

1. Client or agent sends `move {gameId, uci}` over WebSocket.
2. Referee loads the position, checks legality with the engine, checks the clock.
   Illegal or late: reject with a reason. Legal: apply, update clocks, broadcast
   the new position to both players and spectators within one event-loop turn.
3. Insert a `moves` row with state `queued`.
4. The chain writer takes the job from a **per-wallet queue** (one in-flight
   transaction per wallet, so nonces never collide) and calls Circle
   `createContractExecutionTransaction` from the mover's wallet with
   `FinalMoveLedger.move(gameId, ply, uci)`, fee level `HIGH`, and an
   idempotency key derived deterministically from `gameId:ply` (UUID v5) so a
   retry can never write twice.
5. Circle webhook (verified with `X-Circle-Signature`), with polling as a
   fallback, moves the row through `submitted -> sent -> complete`, storing the
   Circle id, tx hash and block.
6. The indexer independently reads `Move` events from the chain and marks the
   row `final`, recording block time. The chain rail shows two measured numbers:
   click to submission, and submission to final.
7. `FAILED`, `DENIED`, `CANCELLED`, or no receipt after 30 s: retry up to three
   times, then relay from the referee wallet. Record why.
8. At game end the referee waits until every ply is `final`, then calls
   `endGame`. Stakes settle by calling `MatchEscrow.settle`, which anyone could
   call.

The board never waits for the chain. The chain never decides the clock.

## Wallets

- One Circle wallet set for the app. One EOA per human and per agent on
  `ARC-TESTNET` (later `ARC`), created at sign-up or agent registration.
- The operator has two wallets: `referee` and `treasury` (top-ups, sponsored
  prize funding).
- Gas: before a game starts, if a player wallet holds under 0.10 USDC the
  treasury sends 0.25 USDC. Daily cap in config, alert when hit. Do not rely on
  Gas Station.
- Balances: use `getWalletTokenBalance`, never `getWallet`.
- Deposits: show the wallet address and QR. Testnet links to the Circle faucet.
- Withdrawals: any amount to any valid address, after a confirmation screen
  naming address, amount and network. Reject `address(0)`.
- Stakes: the player's wallet approves the escrow for exactly the stake, then
  deposits. Two transactions, both from the player's wallet, no popup.

## Data model (Postgres)

`users` (x id, handle, avatar, created), `agents` (owner user, name, api key
hash, model note, status), `wallets` (owner type and id, circle wallet id,
address, chain), `games` (players, class, time control, status, result, reason,
pgn, chain game id, escrow match id), `moves` (game, ply, uci, san, fen after,
clock after, state, circle tx id, tx hash, block, submitted at, final at,
relayed), `matches` (escrow), `tournaments`, `entries`, `ratings` (subject,
class, time control, mu, sigma, games), `chain_events` (raw indexed logs),
`topups`.

## Services in the server

- **auth**: X OAuth 2.0 with PKCE, session cookie (httpOnly, secure,
  sameSite lax). Guest play against house bots without sign-in, no wallet.
- **referee**: game state machine, engine calls, result detection, abandon and
  abort timers.
- **clocks**: Redis-backed, server time only, increment applied on move.
- **matchmaking**: per class and time control, rating window widening over 30 s,
  fallback offer of a house bot.
- **house bots**: five levels on the vendored search (depth and randomness),
  each with its own wallet, so bot games are on chain too.
- **agents gateway** and **MCP**: see agent-api.md.
- **tournaments**: Saturday schedule, registration, bracket from the vendored
  module, pairing, result propagation, pool finalisation.
- **indexer**: viem `getLogs` in bounded ranges from the deployment block, then
  live; idempotent on (tx hash, log index); exposes lag in /health.
- **cards**: share images rendered server side (Satori or @vercel/og) with the
  vendored fonts and tokens.
- **health**: chain head, indexer lag, queue depth, Circle error rate, treasury
  balance, top-up spend today.

## Security

- `CIRCLE_API_KEY` and `ENTITY_SECRET` exist only in server environment. Never in
  the browser bundle, never logged, never committed. The entity secret recovery
  file lives outside the repo.
- Agent API keys are shown once, stored hashed, revocable, rate limited.
- Every mutating Circle call has an idempotency key.
- Webhook signatures verified; unverified webhooks dropped.
- Withdrawals and stake deposits re-check the balance and the game state
  server side.
- Inputs validated with zod at every boundary.

## Environment (.env.example)

```
NETWORK=testnet                 # testnet | mainnet
ARC_RPC_URL=https://rpc.testnet.arc.io
ARC_WS_URL=wss://rpc.testnet.arc.io
ARC_EXPLORER=https://explorer.testnet.arc.io
CIRCLE_CHAIN=ARC-TESTNET
USDC_ADDRESS=0x3600000000000000000000000000000000000000
CIRCLE_API_KEY=
ENTITY_SECRET=
CIRCLE_WALLET_SET_ID=
REFEREE_WALLET_ID=
TREASURY_WALLET_ID=
CIRCLE_WEBHOOK_PUBLIC_KEY_URL=
LEDGER_ADDRESS=
ESCROW_ADDRESS=
POOL_ADDRESS=
DEPLOY_BLOCK=
X_CLIENT_ID=
X_CLIENT_SECRET=
SESSION_SECRET=
DATABASE_URL=postgres://finalmove:finalmove@localhost:5432/finalmove
REDIS_URL=redis://localhost:6379
TOPUP_THRESHOLD_USDC=0.10
TOPUP_AMOUNT_USDC=0.25
TOPUP_DAILY_CAP_USDC=25
PUBLIC_WEB_URL=
```
