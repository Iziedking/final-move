# Deploying Final Move

Production runs in two parts:

- **API host:** one Linux machine (EC2 or any VPS) running the API server, Postgres, Redis and Caddy for TLS, from `deploy/compose.prod.yaml`. Example domain: `api.finalmove.veilap.xyz`.
- **Web app:** the Next.js app in `apps/web` on a hosting platform (Netlify or Vercel, connected from the Integrations menu in the Arc Studio workspace), calling the API on its own origin.

Steps marked **owner** move real money or touch credentials. Only the owner does them.

## 1. Circle wallets on Arc mainnet (owner)

1. In the Circle Developer Console, switch to live mode and create a live API key.
2. Register a live entity secret. Keep the recovery file off the repository and off shared machines.
3. Create a wallet set, then two EOA wallets on blockchain `ARC`: **referee** and **treasury**. Note each wallet id and address.

The referee signs `createGame`, `endGame`, relayed moves and cup calls. The treasury tops up player and bot gas and funds cup prizes.

## 2. Fund the wallets (owner)

Arc charges gas in USDC. Measured costs on testnet at mainnet gas prices (20 gwei): a move is about 0.001 USDC, a whole game 0.03 to 0.10 USDC.

| Wallet | Starting amount | Used for |
|---|---|---|
| Referee | 3 USDC | game start and end, relays, cup create and finalize |
| Treasury | 10 USDC plus the cup prize | gas top-ups (capped by `TOPUP_DAILY_CAP_USDC`) and cup funding |
| Deployer (Arc Studio or your own) | 0.5 USDC | deploying the three contracts |

Keep the cup prize small for the first cup, for example 1 to 5 USDC.

## 3. Deploy the contracts on mainnet

Mainnet contracts use stakes **off** (immutable), the owner Safe and the new mainnet referee:

```sh
cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.mainnet.arc.io --broadcast \
  --sig "run(address,address,address,bool)" \
  0x489C6367E2e943A3cC017589f73cAA8A80d7D028 <REFEREE_ADDRESS> 0x3600000000000000000000000000000000000000 false
```

Owner: `0x489C6367E2e943A3cC017589f73cAA8A80d7D028` (Safe; can change the referee and pause new games, and has no path to pool funds). Referee: the address from step 1. Stakes: `false`.

Record the three addresses, transaction hashes and deploy blocks in `deployments/5042.json`. `DEPLOY_BLOCK` is the lowest of the three deploy blocks; the indexer starts there on a new database.

## 4. API host

Recommended size: 2 vCPU, 4 GB RAM, 30 GB disk (for example EC2 `t3.medium`, Ubuntu 24.04). Firewall: 80 and 443 open to everyone, 22 only from your IP.

```sh
# on the host
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER   # log out and back in
git clone https://github.com/Iziedking/final-move.git /opt/final-move
cd /opt/final-move
nano .env                       # fill in from the table below; chmod 600 .env
```

Point a DNS A record for `api.finalmove.veilap.xyz` at the host's public IP, then:

```sh
docker compose --env-file .env -f deploy/compose.prod.yaml up -d --build
curl -s https://api.finalmove.veilap.xyz/health
```

Migrations run when the server starts. Caddy fetches the TLS certificate on the first request once DNS resolves.

### API `.env` for mainnet

| Key | Value |
|---|---|
| `NETWORK` | `mainnet` |
| `ARC_RPC_URL` | `https://rpc.mainnet.arc.io` |
| `ARC_EXPLORER` | `https://explorer.arc.io` |
| `CIRCLE_CHAIN` | `ARC` |
| `USDC_ADDRESS` | `0x3600000000000000000000000000000000000000` |
| `CIRCLE_API_KEY`, `ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID` | live values from step 1 |
| `REFEREE_WALLET_ID`, `REFEREE_WALLET_ADDRESS`, `TREASURY_WALLET_ID` | from step 1 |
| `BOT_WALLET_IDS` | from step 5 |
| `LEDGER_ADDRESS`, `ESCROW_ADDRESS`, `POOL_ADDRESS`, `DEPLOY_BLOCK` | from step 3 |
| `SESSION_SECRET`, `INTERNAL_SECRET`, `ADMIN_TOKEN` | `openssl rand -hex 32` each; `INTERNAL_SECRET` is shared with the web app |
| `PUBLIC_WEB_URL` | the web app origin, for example `https://finalmove.vercel.app` (CORS allows only this) |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `API_DOMAIN` | `api.finalmove.veilap.xyz` |
| `TOPUP_DAILY_CAP_USDC` | `5` |
| `MAX_GUEST_GAMES_PER_DAY` | empty (50 on mainnet) or a number |

`DATABASE_URL` and `REDIS_URL` are set by the compose file. On mainnet the server refuses to start if any value still points at testnet, an address is zero, `DEPLOY_BLOCK` is missing or a secret is unset.

## 5. House bots

Create the five bot wallets once, then restart:

```sh
docker compose --env-file .env -f deploy/compose.prod.yaml run --rm server bun apps/server/scripts/create-bot-wallets.ts
# put the five ids into BOT_WALLET_IDS in .env, then
docker compose --env-file .env -f deploy/compose.prod.yaml up -d server
```

Bots get gas from treasury top-ups when a game starts. To pre-fund one by hand (owner, moves real USDC):

```sh
docker compose --env-file .env -f deploy/compose.prod.yaml run --rm server bun apps/server/scripts/fund-bot.ts <BOT_ADDRESS> 0.5
```

Which script makes which wallet:

| Wallet | Created by |
|---|---|
| Referee, treasury | the owner in the Circle Console (step 1) |
| Five house bots | `apps/server/scripts/create-bot-wallets.ts` |
| Each signed-in player | the API on first sign-in (`ensureUser`) |
| Each agent | the API on agent registration |

## 6. Web app

Set these on the web host. `NEXT_PUBLIC_*` values are built into the bundle, so set them before building.

| Key | Value |
|---|---|
| `NEXT_PUBLIC_NETWORK` | `mainnet` |
| `NEXT_PUBLIC_API_ORIGIN` | `https://api.finalmove.veilap.xyz` |
| `NEXT_PUBLIC_WS_URL` | `wss://api.finalmove.veilap.xyz` (the app appends `/ws`) |
| `NEXT_PUBLIC_SITE_URL` | the web app's public URL |
| `API_ORIGIN` | `https://api.finalmove.veilap.xyz` |
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `INTERNAL_SECRET` | same as the API |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | from the X developer app; callback `https://<web host>/api/auth/callback/twitter` |

Build command from the repository root: `bun install && cd apps/web && bun run build`. Start: `bun run start` (listens on `PORT`, default 3000).

## 7. Check it end to end

1. `GET https://api.finalmove.veilap.xyz/health` returns `{"ok":true}`.
2. Open the web app, play a guest game against Pawnderer, and open a move's explorer link on `explorer.arc.io`.
3. Sign in with X, open the wallet page and see your Arc address.

## 8. A sponsored cup with real USDC (owner)

Each call needs `Authorization: Bearer <ADMIN_TOKEN>`. Funding moves real USDC from the treasury into the TournamentPool contract.

```sh
API=https://api.finalmove.veilap.xyz
# create (prize in 6-decimal units: 1000000 = 1 USDC)
curl -X POST $API/v1/tournaments -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"name":"Saturday Cup","regClose":"<ISO time>","startsAt":"<ISO time>","prizeUsdc6":1000000}'
curl -X POST $API/v1/tournaments/<id>/fund -H "Authorization: Bearer $ADMIN_TOKEN"
# players register from the Cup page; house bots can be added:
curl -X POST $API/v1/tournaments/<id>/register-bot -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" -d '{"botId":"bot_1"}'
# after registration closes
curl -X POST $API/v1/tournaments/<id>/start -H "Authorization: Bearer $ADMIN_TOKEN"
```

The cup finalizes itself when the last game ends and the pool pays the winners onchain.

## Operations

- **Backups:** a daily dump, copied off the host.
  `docker compose --env-file .env -f deploy/compose.prod.yaml exec -T postgres pg_dump -U finalmove finalmove | gzip > /var/backups/finalmove-$(date +%F).sql.gz`
- **Logs:** `docker compose --env-file .env -f deploy/compose.prod.yaml logs -f server`
- **Balances:** check referee and treasury daily on `explorer.arc.io`. If the referee runs dry, moves and game ends stop reaching the chain (play itself continues).
- **Update:** `git pull && docker compose --env-file .env -f deploy/compose.prod.yaml up -d --build server`
- **Rotate secrets:** change `SESSION_SECRET` (signs everyone out), `INTERNAL_SECRET` (on both API and web at once) or `ADMIN_TOKEN` in `.env`, then restart the server. Rotate the Circle API key in the Console and update `.env`. The entity secret is rotated only through Circle's own flow.
- **Emergency stop:** the owner Safe can call `setPaused(true)` on FinalMoveLedger to block new games onchain; stop the server with `docker compose ... stop server`.
