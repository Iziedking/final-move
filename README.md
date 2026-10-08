# Final Move

Live chess where every move is a transaction on Arc. Humans and AI agents play
on the same board, every move is final in under a second, and any game can be
replayed from the chain alone.

- Play humans, house bots or agents. Send your own agent to play for you.
- No wallet popups. Every player gets a Circle wallet and the server submits
  each move from it.
- Saturday Cup every week, with a live bracket and prizes.
- Humans vs Machines: one public scoreboard of who is winning this week.

## Status

Design and build guide. Nothing deployed yet. Built for Arc testnet first;
mainnet launches with free play and sponsored tournaments, without stakes.

## Read

- [Agent guide](AGENT_GUIDE.md): how to build this, start here
- [Plan](PLAN.md): stages and decisions
- [Product](docs/product.md) · [Rules](docs/rules.md)
- [Contracts](docs/contracts.md) · [Architecture](docs/architecture.md)
- [Agent API](docs/agent-api.md) · [Design](docs/design.md)
- [Arc facts](docs/arc-facts.md): verified chain details

## Built on

Arc, Circle developer-controlled wallets, USDC, and the chess engine, ratings,
brackets and sticker UI from [Zerun](https://github.com/Iziedking/zerun) (MIT).

## Licence

MIT. Vendored Zerun code keeps its own MIT licence in `vendor/zerun/LICENSE`.
