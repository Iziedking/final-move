# Rules

## Chess

Standard FIDE rules, enforced by the vendored engine (`packages/chess`, from
`vendor/zerun/chess/engine.ts`): legal moves including castling, en passant and
promotion; checkmate; stalemate; threefold repetition; the fifty-move rule;
insufficient material. The perft suite must pass before any change to the engine
is merged.

## Moves and the chain

1. The server is the referee. A move is checked for legality the instant it
   arrives. An illegal move is rejected and never reaches the chain.
2. A legal move is applied to the game immediately and both boards update.
3. The move is then written to Arc from the mover's wallet, as `(gameId, ply,
   uci)`. This happens in the background.
4. The **ply number** defines the order of the game, not the order transactions
   land. Black's move may confirm before White's previous move; the record is
   still correct.
5. If a player's move transaction fails three times, the referee writes the
   same move from the referee wallet, marked as relayed. The player is never
   penalised for a chain or Circle failure.
6. A game's result is written to the chain only after every ply is recorded.

## Clocks

- The server's clock is authoritative. Time is measured from when the server
  sends a position to when it receives the move.
- Chain time is never charged to a player. A move's confirmation chip may trail
  the board by a few seconds; the clock does not care.
- Agents get the same clock as humans. Network latency to an agent is the
  agent's own time.
- Flag fall loses, unless the opponent cannot checkmate with any legal sequence,
  in which case it is a draw.

## Results

| Result | How |
|---|---|
| Win | Checkmate, opponent resigns, opponent's flag falls, opponent abandons |
| Draw | Stalemate, threefold, fifty moves, insufficient material, agreement, flag fall against insufficient material |
| Abandon | No move within 60 s of the clock starting, or disconnected for 60 s while on move |
| Aborted | A player never makes a first move within 30 s. No rating change, stakes refunded |

Resignation, draw offers and draw acceptance are transactions too.

## Ratings

TrueSkill (vendored), one rating per class per time control. The leaderboard
ranks by conservative rating (mu minus three sigma), so a few lucky wins do not
top the board.

## Stakes (testnet only)

- Both players lock the same amount in the escrow contract before the first
  move. If either deposit is missing after 60 s, both are refunded and the game
  never starts.
- Win: the winner receives both stakes. Draw or abort: both are refunded.
- If the referee has not settled a match 24 hours after it started, either
  player can call the refund function and both stakes return. The operator
  disappearing never traps money.
- Stakes exist only in the Open class.

## Weekly tournament

- Open class, Saturday, 5+3, knockout bracket seeded by Open rating (vendored
  `bracket.ts`).
- Registration closes 15 minutes before start; no-shows forfeit their first
  game.
- Each round is one game; a draw is replayed once with colours swapped, then
  decided by a 3+2 game where a draw goes to the higher seed.
- Prizes on mainnet come from a pool funded before registration opens, paid out
  by the tournament contract to final placements. No entry fee on mainnet.

## Fair play

- Open class: no restrictions. Agents and engine help are allowed.
- Human class: agents cannot join. Games are scored for engine similarity
  (agreement with the vendored search's top moves on non-obvious positions) and
  move-time patterns. High scores flag the game for human review. Nobody is
  banned automatically.
- Multiple accounts to farm prizes, collusion and deliberate losses in
  tournaments end in removal from prize eligibility.

## Conduct

Chat is off by default; quick emotes only (good luck, good game, well played).
Usernames and agent names are filtered for slurs and impersonation of real
people or companies.
