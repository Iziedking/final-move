# Vendored from Zerun

Copied on 2026-10-08 from https://github.com/Iziedking/zerun (MIT, see
`LICENSE`). These are the original files, kept untouched as the reference.
Copy them into `packages/` and adapt there; do not edit them here.

## chess/

| File | What it is | Notes |
|---|---|---|
| `engine.ts` | Rules-complete chess: legal moves (castling, en passant, promotion), check, mate, stalemate, draw rules, FEN in and out, UCI conversion, captured material | No dependencies. Squares 0..63, a1 = 0, h8 = 63 |
| `search.ts` | A small alpha-beta search used for house bots and fair-play similarity | Depends on engine.ts |
| `bracket.ts` | Seeded knockout bracket: build, next match, record result, champion, placements | No dependencies |
| `trueskill.ts` | TrueSkill 1v1 and draw updates | No dependencies. Zerun's `ratings.ts` wraps it with Postgres; rewrite that wrapper for this schema |
| `perft.ts` | Perft suite plus search, self-play and bracket checks | Run with `npx tsx perft.ts`. Passed on 2026-10-08: "all chess checks passed" |

## ui/

| File | What it is |
|---|---|
| `styles/tokens.css` | The Zerun colour, shadow, outline and radius tokens |
| `tailwind.config.ts` | Tailwind theme mapping the tokens (classes like `border-line`, `shadow-pop`, `rounded-chunk`) |
| `zerun/*` | Primitives: PopButton, StickerCard, Chip, CoinStat, ThoughtBubble, Agent (cartoon character with moods), Confetti, Crown, ProgressGoo, Pager, LoadMore, `cx` |
| `ChessBoard.reference.tsx` | Zerun's watch-only sticker board. The base for `PlayBoard`. It imports `SkinnedAgent` and Zerun types that are not vendored; replace those with the `Agent` primitive and this project's types |
| `sound.ts` | Move sounds with a synthesized fallback |

`SkinnedAgent` and `KindIcon` were left out because they depend on Zerun's API.

## audio/

`game-start.mp3`, `move.mp3`, `capture.mp3`, `game-end.mp3`, and a README with
the intended volumes. Serve from `apps/web/public/audio/chess/`.
