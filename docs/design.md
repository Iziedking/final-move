# Design

Final Move uses the Zerun design system. The kit is in `vendor/zerun/ui`:
tokens (`styles/tokens.css`), the Tailwind config, and the primitives
(`PopButton`, `StickerCard`, `Chip`, `CoinStat`, `ThoughtBubble`, `Agent`,
`Confetti`, `Crown`, `ProgressGoo`, `Pager`, `LoadMore`). Move them into
`packages/ui` and build every screen from them.

## Non-negotiables

- Pale sky background, every surface outlined in ink with a solid offset shadow,
  no blur, rounded corners everywhere. Baloo 2 for display, Nunito for UI,
  JetBrains Mono only for hashes, blocks and addresses.
- One violet primary action per view. Amber for rewards and prizes, mint for
  live and final, coral for danger, check and low time, cyan for info.
- No default component library look, no glassmorphism, no decorative gradients,
  no dark generic dashboard, no stock icons where a drawn one belongs.
- Mobile first at 375 px. Most players arrive from X on a phone.
- Respect `prefers-reduced-motion`. Every interactive element reachable by
  keyboard with a visible focus ring.

## The board

Start from `vendor/zerun/ui/ChessBoard.reference.tsx`, which is a watch-only
sticker board. Build `PlayBoard` on top of it:

- **Squares:** light `--cloud-2`, dark `violet/25`, as in the reference. The
  board sits in a StickerCard with the ink outline and `--pop` shadow.
- **Pieces:** a custom SVG set drawn in the sticker style: 3 px ink outline,
  white pieces filled `--cloud`, black pieces filled `--ink` with a thin violet
  inner highlight, chunky friendly silhouettes that still read instantly as
  standard Staunton shapes. Twelve SVGs in `packages/ui/pieces/`. Until they are
  drawn, the Lichess "cburnett" set may be used as a stand-in with its CC BY-SA
  3.0 attribution in the footer.
- **Input:** tap a piece then a square, or drag. Legal targets show as ink dots
  at 20% opacity; capture targets as rings. Illegal drops spring back.
- **Highlights:** last move amber inset ring; king in check coral glow; the
  selected piece lifts with `--pop-lg`.
- **Promotion:** a small sticker picker with the four pieces over the
  promotion square.
- **Premove:** one premove allowed, shown with a dashed outline, cancelled by a
  right-click or tap on empty space.
- **Coordinates** on the edge squares in Nunito 800, small, ink-3.
- **Flip** button; board orientation follows the player's colour.
- **Keyboard:** type a move in SAN or UCI in a small input under the board.
- **Motion:** pieces slide 120 ms with a soft spring; a capture pops the taken
  piece off with a small squash; checkmate fires the vendored Confetti.
- **Sound:** `vendor/zerun/audio` files with the volumes in its README, a mute
  toggle that persists.

## Around the board

- **Player bars** (from the reference): avatar (X picture for humans, the
  vendored `Agent` character for agents with a robot chip), name, rating,
  captured material.
- **Clocks:** big Baloo numerals in their own sticker cards beside each bar.
  The running clock is mint; under 20 s it turns coral and pulses once per
  second.
- **Move list:** numbered SAN pairs, current move highlighted, tap to review
  (the live board shows a "back to live" chip while reviewing).
- **Chain rail:** narrow column of chips, newest on top: ply, SAN, a state dot
  (grey queued, cyan sent, mint final), measured finality in ms, block number in
  mono, link to the explorer. On mobile, a collapsible bottom sheet with a
  single summary chip ("31 moves final on Arc").
- **Actions:** resign (asks once), offer draw, rematch at the end.
- **Agent thinking:** when an agent is on move and its owner allows it, show its
  short note in a `ThoughtBubble`, exactly like Zerun.

## Screens

1. **Home.** The board as the hero with a live game playing on it, the line
   "Every move is a transaction on Arc", Play now (violet), Watch, Saturday Cup
   countdown, the Humans vs Machines scoreboard.
2. **Play.** Time control, class (Open or Human), opponent: anyone, a friend
   link, a house bot level, or an agent; stake (testnet only).
3. **Game.** Board, bars, clocks, move list, chain rail, actions.
4. **End of game.** Result stamp, rating change, "This game was N moves on Arc.
   Every one is final. Verify it.", share card, rematch, replay.
5. **Replay** `/g/[id]`. Rebuilt from chain events only, with a scrubber and a
   "rebuilt from Arc" chip.
6. **Watch.** Live games grid, featured agent arena game.
7. **Saturday Cup.** Countdown, register, prize pool (amber CoinStat), live
   bracket using the vendored bracket data, champion card with `Crown`.
8. **Leaderboards.** Open and Human, per time control; agents marked.
9. **Agents.** Register an agent, keys, wallet, the agent's record, docs link.
10. **Wallet.** Balance, deposit (address, QR, faucet on testnet), withdraw
    with a confirmation screen, history with explorer links. Testnet balances
    labelled "test USDC, no value".
11. **Profile.** Games, titles, streaks, cups, share.
12. **About and fair play.** What is on chain, what the referee decides, the
    Open and Human classes, money rules.

## Share card

1200 x 630, sky background, a StickerCard with the final position drawn small,
both players with avatars, result stamp, "N moves on Arc", the date, and the
replay URL. One button posts to X with the image and the link.
