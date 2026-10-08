# Contracts

Three contracts in `packages/contracts` (Foundry, Solidity 0.8.x, OpenZeppelin
v5). None of them lets the owner or the referee take player funds.

## Roles

- **Owner.** On mainnet, the existing 2-of-3 Safe
  `0x489C6367E2e943A3cC017589f73cAA8A80d7D028` on chain 5042. On testnet, an
  operator wallet. The owner can rotate the referee and pause *new* games,
  matches and tournaments. It cannot move escrowed funds, change results or
  unpause anything mid-match in a way that traps funds.
- **Referee.** The operator's Circle developer-controlled wallet. It creates
  games, relays moves that failed from a player wallet, writes results, opens
  stake matches and finalises tournaments.
- **Players.** Circle developer-controlled wallets of humans and agents.

## 1. FinalMoveLedger

The permanent record of every game and every move.

### Move encoding

`uint16 uci = from | (to << 6) | (promo << 12)` where squares are 0..63 with
a1 = 0, h8 = 63 (the vendored engine's indexing), and promo is 0 none, 1 knight,
2 bishop, 3 rook, 4 queen.

### State

Per game: white, black, class (0 Open, 1 Human), base and increment seconds,
`escrowMatchId` (zero if unstaked), status (None, Live, Ended), recorded ply
count, a ply bitmap, result, reason, total plies, final position hash.

### Functions

| Function | Who | Rules |
|---|---|---|
| `createGame(gameId, white, black, class, baseSec, incSec, escrowMatchId)` | referee | gameId unused; white != black; neither is zero |
| `move(gameId, ply, uci)` | the player whose turn the ply belongs to (odd ply White, even ply Black) | game Live; ply >= 1; ply not yet recorded. **Does not require the previous ply to be recorded**: moves may land out of order |
| `relayMove(gameId, ply, uci)` | referee | same checks; event marks it relayed |
| `resign(gameId)` | either player | game Live; emits only, the referee writes the result |
| `offerDraw(gameId)`, `acceptDraw(gameId)` | either player | emits only |
| `endGame(gameId, result, reason, totalPlies, finalFenHash)` | referee | game Live; every ply 1..totalPlies recorded; sets Ended |
| `resultOf(gameId)` | anyone | returns status, result, white, black, escrowMatchId |

`result`: 1 White wins, 2 Black wins, 3 draw, 4 aborted.
`reason`: checkmate, resignation, timeout, abandon, stalemate, repetition,
fifty-move, insufficient material, agreement, aborted.

The contract does not validate chess legality; the referee does, with the
vendored engine. Anyone can verify a game by replaying its `Move` events through
the engine and comparing with the result.

### Events

`GameCreated`, `Move(gameId, ply, uci, player, relayed)`, `Resigned`,
`DrawOffered`, `DrawAccepted`, `GameEnded(gameId, result, reason, totalPlies,
finalFenHash)`, `RefereeChanged`.

## 2. MatchEscrow

Holds stakes for one game. Constructor: `(IERC20 usdc, FinalMoveLedger ledger,
bool stakesEnabled, address owner, address referee)`. `stakesEnabled` is
**immutable**. Mainnet deploys with `false`.

| Function | Who | Rules |
|---|---|---|
| `open(matchId, gameId, playerA, playerB, amount, fundDeadline)` | referee | reverts `StakesDisabled` if not enabled; amount > 0 |
| `deposit(matchId)` | playerA or playerB | before fundDeadline; once each; `transferFrom` exactly amount (player approves first) |
| `cancelUnfunded(matchId)` | anyone | after fundDeadline with fewer than two deposits; refunds whoever paid |
| `settle(matchId)` | anyone | ledger says the game Ended; win pays 2 x amount to the winner; draw or abort refunds both |
| `refundAfterTimeout(matchId)` | anyone | 24 h after both deposits and still unsettled; refunds both |

Uses `SafeERC20`, checks-effects-interactions, and a reentrancy guard. Amounts
are USDC with 6 decimals. No fee at launch; the contract has no fee code.

Events: `MatchOpened`, `Deposited`, `MatchCancelled`, `MatchSettled(matchId,
winner, payout)`, `MatchRefunded`.

## 3. TournamentPool

Prize pools for the weekly tournament. Constructor: `(IERC20 usdc, bool
stakesEnabled, address owner, address referee)`, `stakesEnabled` immutable.

| Function | Who | Rules |
|---|---|---|
| `create(tid, entryFee, splitsBps[], regClose)` | referee | entryFee > 0 requires stakesEnabled; splits sum to 10000 |
| `fund(tid, amount)` | anyone (operator, sponsor) | before finalise; contributions tracked per funder |
| `register(tid)` | player | before regClose; once; pays entryFee if any |
| `finalize(tid, placements[])` | referee | after regClose; placements are registered entrants; pays the pool by splits; rounding dust to first place |
| `cancel(tid)` | referee, or anyone 7 days after regClose if not finalised | refunds every entry fee and every funder's contribution |

Events: `TournamentCreated`, `Funded`, `Registered`, `Finalized(tid,
placements, amounts)`, `Cancelled`.

The referee chooses placements. That is trusted, and auditable: every bracket
game is in the ledger, and the bracket page links each placement to its games.

## Tests (Foundry)

Ledger:
- only the correct colour can write a ply; a ply cannot be written twice
- out-of-order plies are accepted; `endGame` reverts while any ply is missing
- relayed moves are marked; only the referee can relay, create or end
- a fuzz test over random ply orders always ends with a complete record

Escrow:
- reverts `StakesDisabled` when constructed with false
- win pays exactly 2 x amount, draw and abort refund exactly, nothing left behind
- `cancelUnfunded` and `refundAfterTimeout` work without the referee
- `settle` cannot pay twice; reentrancy attempt with a malicious token fails
- the owner has no path to the funds (assert there is no such function, and
  pause does not block settle or refunds)

Tournament:
- entry fee rejected when stakes are off; sponsor funding works when off
- payouts match splits exactly with dust to first; cancel refunds every party
- anyone can cancel after the deadline

Invariant test: the escrow's USDC balance always equals the sum of unsettled
deposits; the pool's balance always equals unfinalised contributions plus fees.

## Deployment

1. Testnet: deploy all three with `stakesEnabled = true`, owner and referee the
   operator wallet.
2. Mainnet: deploy with `stakesEnabled = false`, referee the operator's Circle
   wallet, owner the Safe above.
3. Deploy through Circle's Smart Contract Platform from the operator's
   developer-controlled wallet, so no raw private key exists. If that path is
   unavailable, a one-time Foundry deployer key may be used, never committed,
   and ownership transferred to the Safe immediately.
4. After deploying, read back the runtime bytecode and compare it with the build
   output with metadata stripped (the pattern in
   github.com/Iziedking/arc-trade-primitives `script/verify-mainnet.sh`).
   Record addresses, blocks and code hashes in `deployments/<chainId>.json`.
