# Local run guide

For production, see `docs/deploy.md`.

## Shape

```
Browser → :3000 Next.js ──rewrites /v1, /mcp, /health──▶ :3001 API server
Browser ─────────────── WebSocket ws://localhost:3001/ws ─▶ :3001 API server
```

Next.js rewrites cannot carry WebSocket upgrades, so the browser opens the game socket straight to the API. Set `NEXT_PUBLIC_WS_URL=ws://localhost:3001` for local runs (the app appends `/ws`).

## Root `.env` (API server)

Copy `.env.example` to `.env` and fill it in. The main keys:

| Key | Local testnet value |
|-----|---------|
| `NETWORK` | `testnet` |
| `ARC_RPC_URL` | `https://rpc.testnet.arc.io` |
| `ARC_EXPLORER` | `https://explorer.testnet.arc.io` |
| `CIRCLE_CHAIN` | `ARC-TESTNET` |
| `CIRCLE_API_KEY`, `ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID` | your Circle test credentials |
| `REFEREE_WALLET_ID`, `REFEREE_WALLET_ADDRESS`, `TREASURY_WALLET_ID`, `BOT_WALLET_IDS` | Circle wallets |
| `LEDGER_ADDRESS`, `ESCROW_ADDRESS`, `POOL_ADDRESS`, `DEPLOY_BLOCK` | from `deployments/5042002.json` |
| `DATABASE_URL`, `REDIS_URL` | `postgres://...@127.0.0.1:5432/finalmove`, `redis://127.0.0.1:6379` |
| `SESSION_SECRET`, `INTERNAL_SECRET`, `ADMIN_TOKEN` | `openssl rand -hex 32` each |
| `PUBLIC_WEB_URL` | `http://localhost:3000` |

## `apps/web/.env.local` (web)

| Key | Local value |
|-----|---------|
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `INTERNAL_SECRET` | same as the API's |
| `API_ORIGIN` | `http://localhost:3001` |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:3001` |
| `NEXT_PUBLIC_NETWORK` | `testnet` |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | from your X developer app (callback `http://localhost:3000/api/auth/callback/twitter`) |

The web app also reads the root `.env` when it exists, so shared values can live there.

## Start

```sh
docker compose up -d                 # Postgres + Redis on 127.0.0.1
bun install
bun run server                       # API on :3001, runs migrations on start
bun run web                          # Next.js on :3000
```

`scripts/start-local.sh` runs the same steps in one terminal.

## Health checks

| Endpoint | Expected |
|----------|----------|
| `GET http://localhost:3001/health` | `{"ok":true,...}` |
| `GET http://localhost:3000/` | HTTP 200 |

## Migrations

They run on API start. To run them alone: `bun run migrate`.
