# Agent guide

You are building Final Move: live chess where every move is a transaction on
Arc, humans and AI agents play on the same board, and every wallet is a Circle
developer-controlled wallet. This file tells you how to work. Follow it to
completion.

## Read first, in this order

1. `README.md`
2. `PLAN.md`: the stages, the decisions, and each stage's "Done when"
3. `docs/arc-facts.md`: verified chain facts. Use these values, never memory.
4. `docs/product.md`, `docs/rules.md`
5. `docs/contracts.md`, `docs/architecture.md`, `docs/agent-api.md`
6. `docs/design.md` and `vendor/zerun/README.md`

Where this guide and a doc disagree, the doc wins. Where a doc and the live
chain disagree, stop, re-check, and fix the doc first.

## How to work

- Do the stages in order. Do not start a stage until the previous stage's
  "Done when" check has been run and shown passing.
- At the end of each stage, stop and report: what was built, the commands run,
  their output, and anything that deviates from the docs and why.
- Write tests with the code, not after. The chess engine's perft suite runs in
  CI and must never fail.
- Reuse the vendored Zerun code. Do not write a new chess engine, rating system
  or bracket. Do not replace the UI kit with a component library.
- Keep claims honest. Anything on screen about time, cost or finality is
  measured, never hard-coded.
- When unsure about a Circle or Arc API, read the official docs
  (https://developers.circle.com/llms.txt, https://docs.arc.io) before writing
  the call.

## Never

- Never put `CIRCLE_API_KEY`, `ENTITY_SECRET`, private keys or recovery files in
  the repo, the browser bundle, logs or chat. Provide `.env.example` only.
- Never register the entity secret for the owner. The owner does it.
- Never enable stakes or entry fees on mainnet. Mainnet contracts are deployed
  with `stakesEnabled = false`.
- Never move mainnet funds without the owner confirming address, amount,
  network and token.
- Never present an agent as a human, or use real people or companies as player
  or bot names.
- Never let the owner or referee role withdraw escrowed or pooled funds.
- Never mix 6-decimal ERC-20 USDC amounts with 18-decimal native amounts.
- Never block the board on the chain, and never charge chain time to a clock.

## Stack

pnpm workspaces, Node 22, TypeScript strict. Web: Next.js 15 App Router,
Tailwind with the vendored Zerun preset. Server: Hono for HTTP, `ws` for
WebSockets, BullMQ on Redis for queues, Postgres 16 with migrations, zod at
every boundary, viem for reads and the indexer, the official Circle SDK
`@circle-fin/developer-controlled-wallets` for every write. Contracts: Foundry,
OpenZeppelin v5. Tests: Vitest and Foundry.

## Environment

Copy `.env.example` to `.env`. Testnet defaults are filled in. The owner
supplies the Circle API key, entity secret, wallet set id, wallet ids and X
OAuth credentials.

## Definition of done for the whole build

A stranger arriving from X on a phone can sign in with X, play a 5+3 game
against a person, a house bot or an agent, watch every move go final on Arc in
the chain rail, finish with a share card, replay the game from chain events,
register for the Saturday Cup, and withdraw their balance, all without signing
a single transaction themselves. On testnet they can also stake test USDC.
Mainnet runs everything except stakes.

## First message to give Arc Studio

```
Read AGENT_GUIDE.md in this repository and follow it. Start with PLAN.md
Stage 0. Stop at the end of each stage and show its "Done when" check passing
before continuing.
```
