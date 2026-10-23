# Phase 2 design pass (2026-10-23)

The goal was a premium game feel on every screen, in the Zerun sticker system but with Final Move's own board. Nothing here changes the contracts. Everything was tested on node-services in a throwaway workspace, never on the owner's PC.

## What changed for players

### Game screen (`apps/web/src/app/game/[id]/GameClient.tsx`)
- The board is the main element. Clocks and player bars frame it, and a side panel (below the board on phones) holds the move list and the chain record.
- One status line says what is happening: your move, the first-move and first-reply 30 second windows, check, the opponent thinking, review mode, game over.
- Moves: tap, drag, or type SAN or UCI (`e4`, `Nf3`, `O-O`, `e2e4`). Illegal typed moves get a plain message.
- Review: tap any move, use the step buttons, or the arrow keys. Escape returns to the live position.
- Resign asks on the page instead of a browser popup. Draw offers can be declined, expire after 30 seconds, and are hidden against bots, which never accept.
- "On Arc" tab: every move with its chain state (queued, sent, confirming, final), time to finality and an explorer link, plus a progress bar of moves final.
- End card over the board: result stamp, reason in words, my rating change, how many moves are final on Arc with a link to verify, rematch, new game, replay, and a way to see the final position.
- Sounds for move, capture, start and end, with a mute switch that is remembered.
- Confetti only on a checkmate win, and never under reduced motion.

### Home (`apps/web/src/components/HomeClient.tsx`, `HeroBoard.tsx`)
- The hero board shows a real game: a live one when someone is playing (polled), otherwise the latest finished game replayed with each move's real chain state. Nothing is staged.
- A live ticker of moves as they become final on Arc, each linking to its transaction.
- Three ways to play (bots, people, agents), the Saturday Cup with a countdown, and the Humans vs Machines scoreboard.
- New bot picker with each bot's own colour and a short description.

### Every other page
- Shared header and footer (`components/SiteHeader.tsx`) with the sections, theme and X sign-in. On phones the sections become a row of chips.
- Play, challenge, watch, leaderboard, profile, cup, wallet, agents, about and replay restyled to the same standard.
- About is now taken from `docs/rules.md` and `docs/product.md`. It no longer claims automatic suspensions, a future ZK circuit, or a credit for a replaced piece set.
- The Cup page gained an "Enter the Cup" button that calls the existing register route. Guests are asked to sign in.
- Favicon, share image, not-found and error pages, and page titles in the form "Watch · Final Move".

## Server changes made during the pass
| Change | File | Why |
|---|---|---|
| Rematch against a bot starts at once | `apps/server/src/index.ts` | Bots never accepted a rematch offer, so the button did nothing |
| Rematch refuses non-players (403) and a second rematch from one game (409) | `apps/server/src/index.ts` | Anyone could create rematch offers; double accepts could start two games |
| `GET /v1/names?ids=` | `apps/server/src/index.ts`, `apps/web/src/lib/names.ts` | Lists (watch, leaderboard, cup, challenges) showed raw ids; one batched request instead of one per player |
| Share data uses display names and `PUBLIC_WEB_URL` | `apps/server/src/index.ts` | Share titles showed `bot_1 vs guest_…` and a made-up domain |
| Move jobs skip moves already complete or final; no update can downgrade a final move | `apps/server/src/chain/writer.ts` | Found by the restart test: after a SIGKILL, a re-run job pushed a final move back to complete and resubmitted it |

## Verification on node-services
Workspace `/tmp/izie-build-test.J2WyEoAp`, production web build with lint. Three suite runs: run 1 failed on a harness mistake (the test secrets were missing from the env file), run 2 had a fresh database, and run 3 (after the writer fix) reused run 2's database because the stack restart kept the Postgres container.

| Check | Result |
|---|---|
| Typecheck, 5 packages | pass |
| Lint, whole repo | 0 errors, 0 warnings |
| Chess checks incl. 8 SAN cases | pass |
| `next build` with lint | pass (the "Next.js plugin was not detected" warning remains; round 4B) |
| Core suite incl. new design checks D-1 to D-5 | 52/52 (run 2); 50/52 in run 3, where both failures are the matchmaking count seeing run 2's game for the same two test users (one game per run, checked in the database) |
| Restart after SIGKILL and graceful restart | 9/10 in run 2 (real bug, fixed); 10/10 in run 3 |
| Bot vs bot onchain | 4/4 |
| Saturday Cup onchain | 12/12 |

Restart: run 2 failed one check. Move 1 of the restarted game was final at 08:11:29, then after the restart its job ran again, resubmitted it and set it back to complete. With the writer fix, run 3 passed all restart checks and every move ended final. No server errors and no container restarts in any run.

Browser review on the test stack, desktop and 375 px, light and dark:
- Guest game against Pawnderer as black: bot opens, typed move accepted, SAN list, chain marks, clocks run.
- Resign confirm, end card with "All 3 moves are final on Arc", rematch starts instantly with colours swapped, tap-to-move as white.
- No sideways scrolling on 12 routes at 375 px.

## Still open
- Next.js ESLint plugin warning, security headers, sandbox leftovers, `docs/deploy.md`, Redis-backed rate limiter (round 4B).
- Premove is not implemented.
- Draw and rematch offers from a person show only while the page is open; there is no notification elsewhere.
