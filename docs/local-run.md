# Local run guide

Two supported topologies. Use **single-origin** for local development (default). Use **separate-origin** for staging or when deploying the web app and API on different hosts.

---

## Topology 1: single origin behind a proxy (default, recommended for local dev)

Port 5173 is the single public port. `proxy.mjs` (repo root) routes requests by path prefix.

```
Browser → :5173 (proxy.mjs)
           ├── /v1/*, /ws, /mcp/*, /health → :3001 (API server)
           └── everything else             → :3000 (Next.js)
```

**Required `.env` keys (root):**

| Key | Example | Notes |
|-----|---------|-------|
| `ARC_RPC_URL` | `https://rpc.testnet.arc.io` | Arc testnet HTTP RPC |
| `ARC_WS_URL` | `wss://rpc.testnet.arc.io` | Arc testnet WS RPC |
| `CIRCLE_API_KEY` | `TEST_...` | Circle developer API key |
| `ENTITY_SECRET` | 32-byte hex | Circle entity secret |
| `REFEREE_WALLET_ID` | UUID | Circle wallet for signing moves |
| `REFEREE_WALLET_ADDRESS` | `0x...` | Address of the referee wallet |
| `TREASURY_WALLET_ID` | UUID | Circle wallet for fees |
| `CIRCLE_WALLET_SET_ID` | UUID | Circle wallet set |
| `LEDGER_ADDRESS` | `0x...` | FinalMoveLedger contract |
| `ESCROW_ADDRESS` | `0x...` | MatchEscrow contract |
| `POOL_ADDRESS` | `0x...` | TournamentPool contract |
| `USDC_ADDRESS` | `0x...` | USDC contract on Arc testnet |
| `DATABASE_URL` | `postgres://...@127.0.0.1:5432/finalmove` | Postgres |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis |
| `SESSION_SECRET` | 64-char hex | Minimum 32 bytes |
| `BOT_WALLET_IDS` | `uuid1,uuid2,uuid3,uuid4,uuid5` | Five bot wallets, one per level |

**Required `apps/web/.env.local` keys:**

| Key | Example | Notes |
|-----|---------|-------|
| `AUTH_SECRET` | same value as `SESSION_SECRET` | NextAuth v5 secret |
| `NEXT_PUBLIC_EXPLORER_URL` | `https://explorer.testnet.arc.io` | Arc block explorer |

**No `NEXT_PUBLIC_API_ORIGIN` or `NEXT_PUBLIC_WS_URL` needed** — the proxy handles routing.

**Start everything:**

```sh
docker compose up -d          # Postgres + Redis
bun install
bun run dev                   # starts proxy (:5173), API (:3001), Next.js (:3000) together
```

See `package.json` `dev` script or `scripts/start-local.sh` for the exact command sequence.

---

## Topology 2: separate API origin (staging / production)

The web app and API run on different hosts or ports. The browser reaches the API directly — no proxy involved. Next.js `rewrites()` are irrelevant here.

```
Browser → :443 (web, e.g. app.finalmo.ve)
           └── NEXT_PUBLIC_API_ORIGIN / NEXT_PUBLIC_WS_URL → api.finalmo.ve
```

**Additional required vars in `apps/web/.env.local` (or your host's env UI):**

| Key | Example | Notes |
|-----|---------|-------|
| `NEXT_PUBLIC_API_ORIGIN` | `https://api.finalmo.ve` | Full origin, no trailing slash. Set this and the browser will prefix all `/v1/...` calls with it. |
| `NEXT_PUBLIC_WS_URL` | `wss://api.finalmo.ve/ws` | WebSocket URL for the game socket. |

**Also required on the server (Next.js process):**

| Key | Example | Notes |
|-----|---------|-------|
| `API_ORIGIN` | `http://api-internal:3001` | Used by server-rendered pages (`/g/[id]`, `/profile/[id]`) to fetch data. Can be an internal hostname. |

**CORS:** the API server must allow the web origin. Add the `PUBLIC_WEB_URL` to the API's CORS allowlist. It is already read from root `.env`.

**WebSocket proxy note:** Next.js `rewrites()` cannot proxy WebSocket upgrades. When using separate-origin, the browser connects directly to `NEXT_PUBLIC_WS_URL` — no proxy needed and no Next.js rewrite required.

---

## Health checks

| Endpoint | Expected |
|----------|----------|
| `GET /health` (API port 3001) | `{"ok":true}` |
| `GET /` (Next.js port 3000) | HTTP 200 |
| `GET /` (proxy port 5173, single-origin only) | HTTP 200 |

---

## Database migrations

Migrations run automatically on API server startup. To run manually:

```sh
cd apps/server && bun run migrate
```

Current migrations: 001–008. Migration 008 fixes ply-matching in the QA repair and reverts any wrong status promotions.

---

## What `proxy.mjs` does (single-origin only)

- Zero runtime dependencies — plain Node `http` + `net`.
- Routes HTTP by pathname prefix: `/v1/*`, `/ws`, `/mcp/*`, `/health` → API; all others → Next.js.
- Forwards `Upgrade: websocket` connections natively for `/ws` and passes through `Upgrade` for Next.js HMR.
- Runs on port 5173. Start it with `node proxy.mjs` or via `bun run dev`.
