# Phase 2: launch blockers fixed

Done 2026-10-23. Fixes the eight blockers in `phase1-verification.md`, plus the issues found while fixing them.

## Result

On the test VPS (node-services), from a fresh database, the full suite passed 73 of 73:

- Core security and gameplay: 47 of 47.
- Restart: a forced kill and a graceful restart mid-game. The game resumes with correct clocks, the bot replies, and every move ends final: 10 of 10.
- Bot vs bot: 48 moves, all final with transaction hashes, `GameEnded` indexed: 4 of 4.
- Cup: created, four entrants registered onchain, funded, bracket played, finalized onchain, prizes match the pool: 12 of 12.

Static checks: type check passes in all 5 packages, the repository lints clean, the chess checks pass (including 8 new notation tests), and `next build` passes with lint on.

## What changed

### Playing from the browser (blocker 1)
- `apps/web/src/app/api/token/route.ts`: swaps the signed-in session for an API player token on the web server, so the internal secret never reaches the browser.
- `apps/web/src/lib/session.ts`: gets and caches the player token (user or server-issued guest), attaches it to every API call, retries once on expiry, and turns error codes into plain sentences.
- The game socket joins with the token. Home, game, play, challenge, agents and wallet pages all use it.

### Server start (blocker 2)
- Migration 009 had a bare `RAISE NOTICE`, which is invalid SQL. It never ran anywhere, so it is fixed in place.

### Restarts (blocker 3)
- Bot loops restart for every recovered game after a restart.

### Wallets (blocker 4, blocker 6)
- `apps/server/src/users/index.ts`: `ensureUser` creates the profile row and the user's own Circle wallet whenever a signed-in user gets a token.
- The sign-in callback uses the right header and fields.
- Agent wallets use a valid UUID idempotency key.

### Matchmaking (blocker 5)
- Human games need a wallet on each side, so human matchmaking and challenges are for signed-in players. Guests play the house bots.
- Matchmaking now creates exactly one game per pair in one place. Before, two humans got two games and two agents got none.
- The no-match timer stops once a player is matched, and an instant match is no longer overwritten as "queued".
- After a match the browser goes to the game, not the home page.

### Open routes (blocker 7)
- Stake offers are internal only.
- Challenges need a signed-in creator, and the challenger comes from the token. There is a new single-use accept endpoint. The challenger's page follows the friend into the game. Looking at a link no longer uses it up.

### Cup payouts (blocker 8)
- Each entrant registers onchain from their own wallet when they enter, and the transaction is confirmed. Guests cannot enter.
- Creating, approving and funding a cup each wait for confirmation.
- A cup cannot start until registration closes, because the pool only pays out after that.
- Unused prize slots in small cups go to the champion. Recorded prizes use the contract's exact formula.
- New admin route to enter a house bot: `POST /v1/tournaments/:id/register-bot`.

### Also fixed
- Stakes settle only from the indexed onchain end of game. The early, always-failing trigger is gone.
- Agents without a wallet get a clear error instead of a broken game. There is a new `error` message in the agent protocol, documented in `docs/agent-api.md`.
- The move list and chain rail show standard notation (`1. e4 Nf6`), via a new `packages/chess/src/san.ts`. Move review works from the game record, replacing a call to an endpoint that did not exist.
- Players show as "Guest", their X handle, the agent's name or the bot's name, instead of raw ids.
- The home page ticker shows real moves confirmed on Arc (`GET /v1/feed/recent`), each linked to its transaction, instead of hardcoded fake moves.
- The chess package type-checks.

## Still open

- The design pass: piece contrast on the board, the token palette instead of teal, and the premium standard across every screen.
- The production deploy setup from the round 4B brief (sandbox leftovers, security headers, deploy docs).
- The Next.js lint plugin warning during build.
- The in-memory rate limiter. It is fine for one server, but needs Redis before running more than one.
