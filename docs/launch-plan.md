# Final Move launch plan

Written 2026-10-17. Execution starts Thursday 22 October 2026.

## Decisions

- The rest of the build is finished outside Arc Studio, in this repository, to stay inside the Arc Studio 30-day usage limit (87% used on 17 October).
- Arc Studio does one final review pass before launch, nothing more.
- Public testnet launches first. Mainnet stays on hold until testnet has run cleanly and the contracts have been reviewed.
- The owner runs every git command. Tests and builds run on the node-services box, never on the owner's PC.
- No contract changes or deploys for testnet. The testnet contracts in `deployments/5042002.json` stay as they are.

## Where things stand

Done in Arc Studio: stages 0 to 7, testnet QA rounds 1 to 3 and round 4A (launch blockers). Rounds 1 and 2 are verified on node-services. Round 3 is partly verified. Round 4A is not verified yet.

Known gaps after 4A, from Arc Studio's own notes and our audit:

- Tournament entrants are not registered onchain, so cup payouts would still fail.
- It is not confirmed that stake settlement now waits for the onchain end of game.
- The rate limiter lives in memory only.
- The new crash guard keeps the process alive after an uncaught error, which can leave a broken server running instead of restarting it.
- Everything in the round 4B brief: sandbox leftovers, production configuration, one lint setup, security headers, deploy docs and the premium finish across every screen.

## Phase 0. Before Thursday (owner)

1. Push the current code to GitHub (commands are in the chat).
2. Choose the production host. node-services runs Arc, reth and lighthouse nodes, so a separate small VPS (2 vCPU, 4 GB) is the safer home for the public app. node-services stays the staging box.
3. Choose the domain, for example `finalmove.<tld>`, and keep access to its DNS.
4. Create an X developer app for "Sign in with X" and keep the client id and secret ready. Callback URL: `https://<domain>/api/auth/callback/twitter`.
5. Top up the treasury and referee wallets from https://faucet.circle.com (Arc testnet).

## Phase 1. Verify what Arc Studio built (Thu 22 to Fri 23 Oct)

Deploy the latest code to node-services on a fresh database, then prove each round 4A claim:

- An attacker script: with player A's token, try to move, resign, offer a draw, deposit, read the wallet and register agents as player B, and call every admin route without the admin token. Everything must be refused.
- Kill the server mid-game twice; the game must resume with correct clocks and every move must end final.
- Two concurrent moves for one side: exactly one applies.
- An agent long-poll held open while a live game keeps moving.
- Indexer: a failed read must not skip blocks.
- A staked game settles on its own; a 4-player cup pays out.
- A review of the round 3 game screen against `docs/design.md` and the premium brief, as white and as black, in light and dark, on desktop and phone.

Output: a verified list of what works and a fix list of what does not.

## Phase 2. Finish the build here (Mon 26 to Fri 30 Oct)

Work in small batches: fix locally, test on node-services, the owner commits and pushes each batch.

1. Close the phase 1 fix list and the known 4A gaps above.
2. Production readiness (the round 4B brief):
   - remove sandbox leftovers (port 5173, proxy.mjs, the sandbox preview host, RPC proxy code, "Arc Studio sidebar" copy, dev-only middleware);
   - configuration that works on a real host (Auth.js host trust, safe env loading, required settings fail fast, site URL for share links, complete `.env.example`);
   - one lint and build setup;
   - security headers;
   - `docs/deploy.md` for a single-VPS deploy with Caddy, TLS, WebSocket routing, backups and secret rotation.
3. The premium finish across Home, Play, Game, Leaderboard, Watch, Cup, Profile and the end screen: real loading, empty, error and reconnecting states, favicon, titles, share image, no emoji icons, tokens only.
4. A full end-to-end test suite that runs on node-services and covers every item above.

## Phase 3. Arc Studio final review (Mon 2 Nov)

1. The owner pushes the finished code.
2. Send Arc Studio one short review-only prompt: read the repository, check it against `AGENT_GUIDE.md`, `PLAN.md` and the docs, report anything wrong, and change nothing without approval. Keep it to a single turn to save usage.
3. Fix anything it finds here.

## Phase 4. Public testnet launch (Tue 3 to Thu 5 Nov)

1. Provision the production VPS: Docker, Caddy with TLS, the firewall open on 80 and 443 only.
2. Set the production secrets on the server (never in the repository): Circle API key, entity secret, wallet ids, session, internal and admin secrets, X keys.
3. Deploy, then run the end-to-end suite against the live domain.
4. Soft launch: the owner and a few testers for one day.
5. Open it up: announce, and submit to the Arc House and Arc Studio club.

Done when: a stranger can sign in or play as a guest, finish a game against a bot and against a human, see every move final on the Arc explorer, open the replay link, and nothing they do can act for another player or move operator funds.

## Phase 5. Run testnet (from 6 Nov, at least two weeks)

- Watch health, the indexer lag, wallet balances and errors daily.
- Fix bugs in small batches.
- Measure the real gas cost per game and per day against the treasury.

## Phase 6. Mainnet readiness (later, separate decision)

- A contract review or audit, covering the contract notes in `AGENTS.md` (escrow open and settle checks, tournament registration).
- Mainnet contracts deploy with stakes disabled, immutable. Owner: Safe `0x489C6367E2e943A3cC017589f73cAA8A80d7D028`.
- A rehearsal deploy, then mainnet with free play and sponsored cups only.

## Inputs needed from the owner

- The production host and domain (phase 0).
- The X developer app keys (phase 0).
- Testnet USDC for the treasury and referee (phase 0).
- Git pushes after each batch.
- A go or no-go at the end of phases 1, 3 and 4.
