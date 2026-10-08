# Plan

Ten stages. Each ends with a "Done when" check that must be shown passing
before the next stage starts. Everything runs on Arc testnet (5042002) until
Stage 9.

## Decisions (owner, 2026-10-08)

1. Every chess move is a transaction on Arc from the mover's own Circle
   developer-controlled wallet. Nobody signs or approves anything.
2. Stakes in USDC escrow run on testnet only. Mainnet launches with free rated
   play and weekly tournaments funded by the operator or a sponsor, no entry
   fee. Mainnet contracts are deployed with stakes switched off in the
   constructor.
3. Two classes: Open (humans, agents, engine help allowed; stakes and
   tournaments) and Human (rated only, fair-play review, never stakes).
4. Agents connect through a remote API (WebSocket, REST, MCP) with an API key.
5. The chess engine, search, bracket, TrueSkill and UI kit come from Zerun
   (`vendor/zerun`, MIT). The look is Zerun's sticker system.

## Stage 0. Ground truth

- Scaffold the monorepo in docs/architecture.md (pnpm workspaces, TypeScript
  strict, ESLint, Prettier, Vitest, docker-compose for Postgres and Redis).
- Create `packages/chess` from `vendor/zerun/chess`; wire `pnpm --filter chess
  perft`.
- Create `packages/ui` from `vendor/zerun/ui` with the Tailwind preset and fonts.
- Circle: with the owner's API key and registered entity secret (the owner does
  the registration, never the agent), create the wallet set, a referee wallet,
  a treasury wallet and two test player wallets on `ARC-TESTNET`. Fund the
  treasury from the faucet.
- Send one contract execution (USDC `approve` of 0 to any address) from a player
  wallet and measure: request to `SENT`, `SENT` to `COMPLETE`, gas used, fee.
- CI: typecheck, lint, test, perft on every push.
- **Done when:** perft passes in CI; the measured Circle transaction is
  recorded in docs/arc-facts.md with its hash.

## Stage 1. Contracts

- `FinalMoveLedger`, `MatchEscrow`, `TournamentPool` per docs/contracts.md, with
  every listed test, the fuzz test and the invariant tests.
- Deploy script for testnet (stakes enabled) and mainnet (stakes disabled).
- Deploy to testnet; write `deployments/5042002.json`; bytecode check script.
- **Done when:** `forge test` passes, including fuzz and invariants; the
  testnet addresses respond; the bytecode check prints OK for all three.

## Stage 2. Referee and chain writer

- Server skeleton: config with zod, health endpoint, Postgres migrations, Redis.
- Referee game loop on the engine, clocks, results, abort and abandon.
- Chain writer with per-wallet queues, idempotency keys, Circle webhooks with
  polling fallback, retries and relay.
- Indexer for all contract events, idempotent, with lag in /health.
- Gas top-ups from treasury with a daily cap.
- House bots, five levels, each with a wallet.
- **Done when:** a script plays bot vs bot to checkmate on testnet; every ply is
  `final`; `endGame` landed; the game replays identically from chain events.

## Stage 3. The board

- X sign-in, wallet creation at sign-up, guest mode against bots.
- PlayBoard and the game screen per docs/design.md, chain rail, sounds.
- Human vs house bot end to end.
- **Done when:** on a 375 px phone a signed-in player beats or loses to a level 1
  bot, sees every move go final in the chain rail with measured times, and the
  end screen links to the explorer.

## Stage 4. Human vs human

- Matchmaking per class and time control, challenge links, resign, draws,
  rematch, TrueSkill per class and control, leaderboards.
- Human-class fair-play scoring that flags for review.
- **Done when:** two browsers play a full 3+2 game; ratings update; a draw by
  repetition is detected; an abandoned game is awarded correctly.

## Stage 5. Agents

- Agent registration, keys, wallets; WebSocket, REST and MCP per
  docs/agent-api.md; the three example agents; agent arena and Watch page.
- **Done when:** each example agent plays a full game on testnet from a fresh
  clone; a human beats or loses to an agent; an agent vs agent game is
  watchable live.

## Stage 6. Stakes on testnet

- Wallet page with deposit, faucet link, withdrawal with confirmation.
- Stake selection, approve and deposit from both wallets, start only when both
  are in, settle, cancel, timeout refund.
- **Done when:** a staked win pays exactly twice the stake; a draw refunds both;
  an unfunded match refunds the one depositor; the timeout refund works with the
  server stopped.

## Stage 7. Saturday Cup

- Tournament scheduling, registration, prize pool funding, bracket, pairings,
  tie-break rules, finalisation and payouts, the bracket page and champion card.
- **Done when:** an 8-player cup of bots and agents runs on testnet from
  registration to payout, and payouts match the splits to the unit.

## Stage 8. Proof and sharing

- Replay page from chain events only, share cards, Humans vs Machines
  scoreboard, profiles, titles and streaks, About and fair-play pages.
- **Done when:** any finished game's replay matches its server record move for
  move, and its share card renders and posts.

## Stage 9. Mainnet

- Measure gas per move and per game on testnet; size the treasury float.
- Deploy to Arc mainnet with stakes disabled, owner the Safe, referee the
  operator wallet; bytecode check; `deployments/5042.json`.
- Switch `NETWORK=mainnet`; create mainnet wallets; fund the treasury.
- Launch checklist: health green, indexer at head, top-up cap set, About page
  live, stakes UI hidden on mainnet.
- **Done when:** a full human vs agent game and a 4-player sponsored cup run on
  mainnet, with replays working.

## After launch

Human-class cups, puzzles of the day, agent seasons, Arc Privacy Sector for
hidden information variants when it ships, mainnet stakes only after legal
advice.
