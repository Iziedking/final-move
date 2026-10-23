# Phase 1 verification: Arc Studio rounds 3 and 4A

Run on 2026-10-23 against commit `55ab4b1` (the round 3 and 4A code exactly as Arc Studio left it).

## How it was tested

- Host: node-services (owner-selected test VPS), throwaway workspace `/tmp/izie-build-test.ERUb9Tpx`, fresh Postgres on tmpfs, Redis, API and web in capped containers, ports bound to localhost.
- Same Arc testnet contracts and Circle wallets as staging. Throwaway secrets for session, internal and admin.
- A scripted suite (`verify.ts`) calling the API the way a browser and an attacker would, plus a forced kill and a graceful restart mid-game, a full bot-vs-bot game, and a browser check of the real web flow.
- Result: 39 of 47 scripted checks passed. The failures and code findings below block a public launch.

## Passed

- Migrations 001 to 009 on a fresh database (after one test-only patch, see B1).
- Bots set themselves up from Circle on a fresh database.
- Public `/health` shows liveness only.
- Server-issued guest tokens. No token: 401. Another player's token: 403 on move and resign. Body `playerId` ignored.
- WebSocket join with a token.
- Two simultaneous moves for one side: exactly one applied.
- Every admin route refused without the admin token. Stake open, settle and cancel refused without the internal secret.
- `/v1/users/upsert` refused without the secret. Another user's wallet unreadable. Guests cannot register agents.
- Agent long-poll no longer blocks the server (other requests answered in 46 ms during a 20 s poll; `wait=0` returns).
- Bodies over 64 KB rejected (413). IP rate limit trips (56 of 140 burst requests got 429).
- Abort when the human never moves, as white and as black. Guests never rated.
- A game survives a forced kill and a graceful restart: same position, still live, the human can move.
- Bot vs bot: 46 moves, all final, all with a transaction hash, `GameEnded` indexed by exact game id, replay correct.
- `next build` with lint on: passes.
- No uncaught errors and zero crash restarts during the run.

## Blockers

1. **Nobody can play from the browser.** The web app never asks `/v1/session` for a token and never sends one. Pressing Play returns 401 and the user sees a raw `unauthorized`. The game page joins the WebSocket with `playerId` instead of `token`, so it hangs on "Connecting..." forever. Reproduced in a browser.
2. **Migration 009 breaks every server start.** `RAISE NOTICE` sits outside a `DO` block, which is invalid SQL, so the migration rolls back and the server stops. Arc Studio's notes say 009 ran; it cannot have with this code. (Patched in the test copy only to continue testing.)
3. **Bots stop after a restart.** `referee/rehydrate.ts` rebuilds live games but never reschedules a bot that is on move, so every human-vs-bot game freezes after any restart or deploy.
4. **Signed-in users never get a wallet.** The web app calls upsert with header `X-Internal-Key` and body `xId`; the server expects `X-Internal-Secret` and `id` plus `handle`, so it always returns 403. Even a correct call only writes the `users` row; it never creates a Circle wallet. `apps/web/src/lib/server-auth.ts`, named in Arc Studio's notes, does not exist.
5. **Human-vs-human matchmaking is impossible.** The queue requires a wallet (`no_wallet`), and neither guests nor signed-in users have one (see 4).
6. **Agents get no wallet.** Agent wallet creation uses the idempotency key `agent:<id>`, which Circle rejects as not a UUID.
7. **Two money routes are still open.** `POST /v1/stakes` (create offer) and `POST /v1/challenges` take player ids from the body with no auth.
8. **Cup payouts cannot succeed.** Entrants are never registered onchain (Arc Studio's own contract note 3).

## Should fix before launch

- Staked games still trigger the payout from the referee immediately (`referee/game.ts` around lines 405 and 525) as well as from the indexer, so the early call fails every time.
- The "Next.js plugin was not detected" lint warning persists.
- The home page ticker shows hardcoded "confirmed" moves, not real activity. Misleading on a product built on verifiability.
- The design drifted from `docs/design.md`: board squares are brown wood (light) and teal (dark) instead of the token palette, and the home page is the centred card stack the premium brief ruled out. A visual review of the new game screen was impossible because of blocker 1.
- Errors shown to users are raw codes (`unauthorized`).
- The rate limiter is in memory; fine for one server, not for more.

## Not verified at runtime

- Indexer behaviour when reading logs fails (code reviewed only).
- A staked game settling end to end, and a cup paying out (blocked by 4, 5 and 8).
- Circle webhook signature check.

## Evidence

Result files (`result-core.json`, `result-restart-pre.json`, `result-restart-post-kill.json`, `result-restart-post-final.json`, `result-bvb.json`) and the lint build log were collected from the workspace. The workspace is kept on node-services for diagnosis because tests failed; its containers are stopped.
