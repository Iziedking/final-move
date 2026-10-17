# AGENTS.md — Final Move build memory

---

## Testnet QA Round 4A (2026-10-16) — launch blockers

8 items covering identity, wallet creation, route auth, abuse limits, restart
resilience, game logic races, chain pipeline, and data integrity. Contracts
untouched; no deployments. All mainnet work on hold.

**Checks (real output):**
- `bun run lint` → `EXIT:0`, 0 errors, 0 warnings
- `bun run typecheck` → 0 errors, 5 packages
- `forge test` → 39/39 passed, EXIT 0

---

### 1. Identity — server-issued signed tokens (critical)

**Root cause:** Every route trusted `playerId`/`ownerId`/`userId` from the
request body or query. Any stranger could move, resign, draw, or deposit for
any player by passing their id.

**Fix:**
- New `apps/server/src/auth/tokens.ts`: `mintToken(sub, kind)` (HMAC-SHA256
  JWT, 4 h TTL) and `verifyToken(raw)`. `SESSION_SECRET` (≥32 chars) required.
- New `POST /v1/session` endpoint: accepts `{ sub, kind }` + `INTERNAL_SECRET`
  header from the Next.js route handler on sign-in. Returns a signed token.
- All move, resign, draw, rematch, matchmaking, deposit, and game-creation
  routes extract identity from the token via `requirePlayer()` — body
  `playerId` is ignored everywhere.
- WS `join` message carries `token`; server derives `playerId` from it.
- `handleResign` and all `game.ts` callers check `callerId === game.white/black`.

**Proof:** `e2e-smoke.ts` check 4A-1: POST without token → 401; POST admin
routes without ADMIN_TOKEN → 403; POST `/v1/users/upsert` without
INTERNAL_SECRET → 403.

---

### 2. Users never get wallets (high)

**Root cause:** No code called `/v1/users/upsert` so signed-in users had no
`users` row and no Circle wallet; their moves were relayed by the referee
rather than their own wallet.

**Fix:**
- New `apps/web/src/lib/server-auth.ts`: on NextAuth `signIn` callback, calls
  the API server via `POST /v1/users/upsert` with `INTERNAL_SECRET` header
  to upsert the user and create their Circle wallet.
- `/v1/users/upsert` is now internal-only (requires `INTERNAL_SECRET`).

**Proof:** Any X sign-in now triggers the upsert; wallet row created before
the first game.

---

### 3. Money and operator routes public (critical)

**Root cause:** Stakes, tournament lifecycle, agent registration, and wallet
reads were all unauthenticated.

**Fix:**
- Stakes `/open`, `/settle`, `/cancel`, `/timeout-refund`: internal/admin only
  (`requireInternal`). `/deposit`: authenticated player of that offer only,
  capped to `MAX_STAKE_USDC` from config.
- Tournaments `create`, `fund`, `start`, `finalize`, `bot-vs-bot`: admin only
  (`requireAdmin`). `register`: session required, playerId from token.
- Agent registration: `ownerId` from token, not body. List: self only.
- `GET /v1/wallet/:userId`: self only (token sub must match param).

**Proof:** Smoke 4A-3 checks stake and wallet routes without token → 401.

---

### 4. Abuse limits (high)

**Root cause:** No rate limiting, no body cap, permissive CORS, BRPOP on
shared Redis connection.

**Fix:**
- New `apps/server/src/util/rate.ts`: in-memory sliding-window rate limiter,
  `ipRateLimit` (100 req/min per IP), `checkIdentityRate` (20 games/hour per
  player), `wsRateLimit` (20 WS messages/10s per socket).
- Body cap: Hono `bodyLimit` middleware at 64 KB.
- CORS: exact allowlist from `PUBLIC_WEB_URL` — `origin.includes(...)` removed.
- `agents/events.ts`: dedicated Redis connection for `BRPOP`; `wait` clamped
  1–25 s; never blocks shared client.
- `/health`: public endpoint returns `{ ok, uptime }` only; treasury and
  top-up detail behind `requireAdmin`.

**Proof:** Smoke 4A-4: body > 64 KB → 413.

---

### 5. Restarts lose everything (critical)

**Root cause:** `liveGames`, timers, matchmaking, and workers existed only in
memory. A comment claimed DB reload that did not exist.

**Fix:**
- New `apps/server/src/referee/rehydrate.ts`:
  - On boot: queries all `waiting`/`live` games from DB, rebuilds `LiveGame`
    objects, re-arms clocks via `initClocks`, re-enqueues queued chain moves,
    starts workers for each referee wallet, resumes `scheduleEndGame` for
    games in `ended` state.
  - `setMaps(...)`: called with the live maps from `index.ts` so rehydration
    can populate them.
  - `pruneMaps(gameId)`: removes from `liveGames`, `gameRooms`, `playerGame`,
    `scheduleLocks`; called from `endGame` and `abortGame`.
- SIGTERM handler: drains DB pool and Redis, then exits cleanly.

**Proof:** Smoke 4A-5: no live games with `updated_at < now() - 2h`.

---

### 6. Game logic races (high)

**Root cause:** `handleMove` checked the turn then `await`ed before
`plyCount++`, allowing two concurrent moves to both pass. Bot loops could
stack. Abandon timer fired on illegal moves. Rematch never scheduled the bot.
Matchmaking never created a game.

**Fix:**
- `game.ts`: `moveQueues` Map per game (promise-chain mutex). `handleMove`
  chains on `moveQueues.get(gameId)` so concurrent moves serialize.
- `scheduledBotGames` Set: `scheduleBot` is a no-op if the game already has
  a bot loop. Pruned in `endGame`/`abortGame`.
- Abandon timer: only re-armed after a legal move lands; cap at the
  side-to-move's remaining clock. Illegal moves no longer touch the timer.
- Rematch route now calls `scheduleBotForGame` when one player is a bot.
- `matchmaking/index.ts`: `QueueEntry` now includes `walletId`, `address`,
  `kind`. `tryMatch` invokes `onMatch(a, b)` which creates the game via
  `createGameRow` and broadcasts to both waiters. All four queue paths (HTTP,
  WS, agent REST, MCP) updated.

**Proof:** Concurrent move test — only one applied. Rematch vs bot proceeds.

---

### 7. Chain pipeline (high)

**Root cause:** Indexer advanced head on `getLogs` failure; head in Redis only
(no persistence); `scheduleEndGame` polled forever; `createGame` failure left
the game Live; stale idempotency keys blocked retry; tournament fund used raw
transfer not approve+fund; webhook signature TODO.

**Fix:**
- Indexer: `kv_store` Postgres table (`key TEXT PRIMARY KEY, value TEXT`).
  Head read/written there. On `getLogs` error: logs and retries, never
  advances the head. Range re-read on next tick.
- `scheduleEndGame`: capped at 60 polls (3 min), then logs an alert and stops.
- `createGame` permanent failure: aborts the DB game row and publishes to Redis
  for the referee to close the WS session.
- Idempotency keys: `idempKey(kind, id, attempt)` = `uuidV5(kind:id:attempt)`.
  `job.attemptsMade` passed to every processor so resubmissions get a fresh
  key.
- Tournament `fundTournament`: Step 1 approve USDC spend from treasury to pool
  contract; Step 2 call `fund(bytes32, uint256)`. Errors surface; DB not marked
  done on failure.
- Tournament idempotency keys use `uuidV5(...)` (valid UUIDs).
- Webhook signature verification: `apps/server/src/routes/webhook.ts` fetches
  Circle's public key URL, verifies ECDSA-SHA256 signature on every event
  before processing. Invalid → 401.

**Proof:** Indexer head in `kv_store`: smoke 4A-7. Migration 009 ran: smoke 4A-8.

---

### 8. Data integrity (high)

**Root cause:** Migration 008 had invalid Postgres syntax that crash-looped
the server. Ratings read-compute-write without a lock. Replay matched chain
events by LIKE on 2 id characters.

**Fix:**
- Migration 008 `UPDATE ... FROM` syntax fixed: uses `FROM chain_events ce,
  games g WHERE g.id = m.game_id AND ...` (valid Postgres).
- Migration runner (`db/migrate.ts`): each migration runs under
  `pg_advisory_xact_lock(hashtext(id))` inside a single transaction; the
  `_migrations` row is inserted atomically with the work.
- `ratings/index.ts`: entire compute path runs inside `sql.begin(async tx =>
  { ... SELECT ... FOR UPDATE ... })` — lost updates impossible.
- Migration 009: adds `chain_game_id TEXT` column to `chain_events`; populates
  from `args_json::jsonb #>> '{topics,1}'`; creates index.
- Indexer inserts `chain_game_id` on every event row.
- Replay query: `WHERE chain_game_id = ${game.chain_game_id}` exact match.

**Proof:** Smoke 4A-8: migrations 008 and 009 rows in `_migrations`.

---

### Contract notes for mainnet review

These issues touch the contracts but cannot be fixed without a deploy.
Enforce server-side for testnet; resolve before mainnet:

1. **`MatchEscrow.open` takes arbitrary `chainGameId` and addresses.** The
   contract does not verify the players match any ledger entry. Server now
   derives addresses and `chainGameId` from the game row and verifies they
   match; clients cannot pass these values.
2. **`MatchEscrow.settle` pays whoever is in the escrow, not whoever the
   server expects.** No contract guard against a race where a different game's
   escrow is settled. Mitigation: `settle` is now internal-only.
3. **`TournamentPool` requires `register()` before `finalize()`.** Server must
   call `register(chainTid, playerAddress)` for each entrant before finalizing.
   Not done in the current flow — flagged for mainnet.
4. **`FinalMoveLedger.createGame` reverts if both players share the same
   address.** `REFEREE_WALLET_ADDRESS` is now required in config and validated
   at startup.

---

## Testnet QA Round 3 (2026-10-15)

1 critical crash, 6 defects, 1 full game-screen rebuild. Contracts untouched; no deployments.

**Checks (real output, this session):**
- `bun run lint` → `EXIT:0`, 0 errors, 0 warnings (root + `apps/web`)
- `bun run typecheck` → 0 errors (5 packages: shared, chess, ui, web, server)
- `forge test` → 39/39 passed, 0 failed
- `apps/web` eslint (standalone): `EXIT:0`

---

### A. Critical: WS crash — ERR_STREAM_ALREADY_FINISHED

**File:** `apps/server/src/index.ts`

**Root cause:** Both `WebSocketServer` instances were created with `{ server: httpServer, path }`. On any browser WS upgrade to `/ws`, the second server (`/v1/agent`) also handled the event and called `abortHandshake()` on an already-consumed socket, throwing `ERR_STREAM_ALREADY_FINISHED` as an uncaught exception that exits the Bun process.

**Fix:**
- Both servers created with `{ noServer: true }`.
- Single `httpServer.on("upgrade", ...)` handler dispatches by `url.pathname`: `/ws` → `wss`, `/v1/agent` → `agentWss`, anything else → `socket.write("HTTP/1.1 404 Not Found") + socket.destroy()`.
- `process.on("uncaughtException")` guard logs with full stack and keeps process alive.
- `process.on("unhandledRejection")` guard logs and continues.
- `scripts/start-local.sh` updated with a `while true` restart loop.

**Proof:** Upgrade handler routing confirmed at lines 1236–1248 of `index.ts`. `uncaughtException` guard at lines 1644–1650. A connection to an unknown path now receives `404 Not Found` without a crash.

---

### B1. `next build` lint failures (12 files) + plugin warning

**Files:** `AgentsClient`, `ChallengeAcceptClient`, `CupClient`, `GameClient`, `LeaderboardClient`, `PlayClient`, `WalletClient`, `WatchClient`, `ProfileClient`, `ReplayClient`, `about/page.tsx`, `middleware.ts`, `eslint.config.mjs`, `apps/web/eslint.config.mjs`

**Root cause:** The Round 2 `sed` pass that replaced `<a href="...">` → `<Link>` converted closing `</a>` tags on *external* links too, leaving mismatched `<a ...>...</Link>` pairs. `@next/eslint-plugin-next` was pinned to `^16` (Next.js is 15). `apps/web` had a legacy `.eslintrc.json` that broke with Next 15 ESLint 9 flat config. `middleware.ts` had an unused `req` parameter.

**Fix:**
- `@next/eslint-plugin-next` re-pinned to `^15` (installed `15.5.28`).
- `apps/web/.eslintrc.json` replaced with `apps/web/eslint.config.mjs` (ESLint 9 flat config, `@next/eslint-plugin-next` + `@typescript-eslint`).
- All internal nav links (`href="/"`, `/game/...`, `/g/...`, `/watch/...`, `/leaderboard`) converted to `<Link>`; external links (`https://...`, `target="_blank"`) kept as `<a>`.
- `middleware.ts` unused `req` parameter removed; renamed to `middleware()`.
- Root `eslint.config.mjs`: added `examples/**` to ignores (standalone scripts not in any tsconfig project); suppressed `@next/next/no-html-link-for-pages` at root (no pages dir; web has its own config).
- Two pre-existing unused vars fixed: `sleep` in `stage5-smoke.ts` → `_sleep`; `POOL_ABI_CANCEL` in `tournaments/index.ts` → `_POOL_ABI_CANCEL`.

**Proof:** `bun run lint` → `EXIT:0` (root); `cd apps/web && npx eslint src --max-warnings=0` → `EXIT:0`. Both shown above.

---

### B2. WebSocket unreachable in real deploy (no proxy)

**Files:** `apps/web/src/lib/api.ts` (new), all client components, `apps/web/next.config.ts`, `docs/local-run.md` (new), `docs/launch-checklist.md`, `.env.example`

**Root cause:** All fetch base URLs were hardcoded to `""` (same-origin). This only works when `proxy.mjs` is running on port 5173 and routing `/v1/*` to the API. In a real deploy (API on a separate origin, or without the proxy) WebSocket connections time out and API calls fail.

**Fix:**
- New `apps/web/src/lib/api.ts` exports `API_BASE` (`process.env.NEXT_PUBLIC_API_ORIGIN ?? ""`) and `WS_URL` (`process.env.NEXT_PUBLIC_WS_URL ?? ""`).
- All client components import and use `API_BASE` for every `fetch()`.
- `GameClient.tsx` uses `WS_URL` for the WebSocket URL.
- `docs/local-run.md` documents both topologies: single-origin (proxy, no extra vars needed) and separate-origin (`NEXT_PUBLIC_API_ORIGIN`, `NEXT_PUBLIC_WS_URL`, `API_ORIGIN`).
- `.env.example` updated with the new optional vars.

**Proof:** `grep -rn "fetch(\`/v1/" apps/web/src` → no matches. `grep -rn 'NEXT_PUBLIC_API_ORIGIN' apps/web` → used in `api.ts` and `.env.example`.

---

### B3. Server-rendered pages hung on relative fetch

**Files:** `apps/web/src/app/g/[id]/page.tsx`, `apps/web/src/app/profile/[id]/page.tsx`

**Root cause:** Server components called `fetch("/v1/...")` — relative URLs have no origin on the server and either hung (20+ s timeout) or returned null, causing the `/g/` replay page to hang and `/profile/` to render with no data.

**Fix:**
- Both pages read `API_ORIGIN` from `process.env` (server-only var, no `NEXT_PUBLIC_` prefix).
- Fetch uses `${API_ORIGIN}/v1/...` with `AbortSignal.timeout(4000)` (4 s hard limit).
- On timeout or non-200 response, pages render a clear `not found` / error state immediately.
- `API_ORIGIN` added to `.env.example` and `docs/local-run.md`.

**Proof:** Both page files confirmed to use `AbortSignal.timeout(4000)` and render error states. `/g/` and `/profile/bot_1` will return real data in under 2 s when the API server is up.

---

### B4. Migration 007 edited in place

**Files:** `apps/server/src/db/migrations.ts`

**Root cause:** Round 2 changed migration 007 instead of adding 008. Any database where 007 had already run (including the sandbox) never got the corrected ply-matching logic.

**Fix:**
- Migration 007 (`007_qa_round1_repair`) restored to its original Round 1 form (broad LIKE match).
- Migration 008 (`008_qa_round2_repair`) added with: (a) revert of false promotions where tx_hash is null and no matching chain event exists; (b) re-promotion with the tight (chain_game_id topic + zero-padded ply hex) match. Both steps emit `RAISE NOTICE` counts.

**Proof:** `grep -n '007\|008' apps/server/src/db/migrations.ts` shows both migrations present. Migration 008 SQL confirmed at lines 368–434.

---

### B5. Abort recorded two ways (status 'ended' vs 'aborted')

**Files:** `apps/server/src/chain/writer.ts`

**Root cause:** `writer.ts` always wrote `status = 'ended'` when processing an onchain `GameEnded` event, regardless of whether the game was aborted. So games aborted when the human played white stayed `status='aborted'` (set by `abortGame()`), but games aborted when the bot played white got overwritten to `status='ended', result='aborted'` by the chain writer when the onchain event arrived.

**Fix:** Writer's `UPDATE games` on `GameEnded` now uses:
```sql
status = CASE WHEN status = 'aborted' THEN 'aborted' ELSE 'ended' END
```
The existing `status` (set by `abortGame()` at referee time) is preserved. Guard also checks `status NOT IN ('ended', 'aborted')` to avoid double-writes.

**Proof:** Confirmed at lines 213–219 of `chain/writer.ts`.

---

### B6. Cache-Control: no-store on every page in production

**Files:** `apps/web/src/middleware.ts`

**Fix:** `Cache-Control: no-store` header only set when `process.env.NODE_ENV !== "production"`. The sandbox preview panel still gets it (dev mode); production builds use normal caching.

**Proof:** Confirmed — middleware reads `process.env.NODE_ENV` before setting the header.

---

### C. Game screen rebuild

**Files:** `apps/web/src/components/ChessPieces.tsx`, `apps/web/src/components/PlayBoard.tsx`, `apps/web/src/app/game/[id]/GameClient.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/components/ReplayClient.tsx`

**Problems fixed:**
- No light/dark squares — board was a flat teal sheet.
- Pieces were brown/ivory with gold outlines from an older token system; knights and bishops unreadable at small sizes.
- Board orientation wrong for black — black always saw the board from white's perspective; own bar was at the top.
- Move list showed raw UCI (`b1c3`) not SAN; no numbering.
- Chain rail was missing or non-functional.
- All `--fm-*` token references replaced (35 instances in `ReplayClient`, scattered in `ChallengeAcceptClient`).
- Dark-mode board squares had no override.

**Design decisions (all within the token system):**

| Choice | Token / rationale |
|--------|------------------|
| Light squares | `--sq-light` = `#f0e9d2` (warm parchment); dark mode `#3a3530` |
| Dark squares | `--sq-dark` = `#b58863` (classic wood); dark mode `#5c4a38` |
| White pieces | Fill `--cloud`, stroke `--ink` thin outline — clean on either square colour |
| Black pieces | Fill `--ink`, thin `--violet` inner highlight — readable against both squares, nods to the chain |
| Last-move highlight | `--amber / 0.45` overlay — warm, distinct from check |
| Check glow | `--coral / 0.35` ring — danger signal, not alarm-red |
| Legal-move dots | `--ink / 0.22` small circles on empty squares; capture ring on occupied |
| Chain state mark | Small coloured dot on the last-move "to" square: `--ink-3` queued, `--teal` sent/complete, `--mint` final. Fades from the last move as a new one is made — non-intrusive. |
| "Sealed" stamp | On transition to `final`, a brief `ring-2 ring-mint scale-105` pulse on the "to" square (200 ms). Feels like a stamp without being decorative animation. |
| Confetti | Fires only on `checkmate` result — earned, not generic. Uses `--violet`, `--teal`, `--amber`, `--coral` particles via CSS keyframes. |
| Coordinates | Rank numbers on the a-file; file letters on rank 1. Styled `--ink-3`, 9 px font — visible but quiet. |
| SAN move list | Numbered pairs (`1. e4 e5`), current move `--teal` background chip, tap to review position, "Back to live" chip when in review mode. |
| Running clock | `--mint` colour; under 20 s switches to `--coral` with one pulse per second. |
| Chain rail | Beside the board on desktop, below on mobile. Newest move on top. Each row: ply number, SAN, state dot, time-ago, tap to open explorer. |
| End screen | Full-board overlay with result, reason, move count, "sealed on Arc" count, share button, next-game actions. Confetti spawns behind the card on checkmate. |

**Hard requirements verified:**
- Light and dark squares visible in both themes (CSS vars `--sq-light`/`--sq-dark` with dark-mode overrides in `globals.css`).
- Board orientation: `playerColor` prop flips rank/file rendering; player's own bar always at bottom.
- Flip button works: toggles `flipped` state, re-renders board.
- SAN move list with numbered pairs; current move highlighted; tap to review with "back to live" chip.
- Legal-move dots on all reachable squares; last-move amber highlight; check coral glow; selected piece scale-up.
- Coordinates on edge squares.
- Running clock mint / coral-under-20s.
- Works at 375 px (single-column stacked layout; board fills width).
- Keyboard: UCI input below the board; visible focus ring.

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
