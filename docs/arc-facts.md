# Arc facts this build relies on

Every row was checked on 2026-10-08, by RPC call or from the named page. If a
fact here disagrees with what you observe, stop, re-check, and update this file
before writing code that depends on it.

| Fact | Value | How it was checked |
|---|---|---|
| Mainnet chain id | 5042 (`0x13b2`) | `eth_chainId` on https://rpc.mainnet.arc.io |
| Testnet chain id | 5042002 (`0x4cef52`) | `eth_chainId` on https://rpc.testnet.arc.io |
| Mainnet RPC | https://rpc.mainnet.arc.io (also Alchemy, Blockdaemon, dRPC, QuickNode) | docs.arc.io connect-to-arc |
| Testnet RPC | https://rpc.testnet.arc.io, WebSocket wss://rpc.testnet.arc.io | docs.arc.io connect-to-arc |
| Mainnet WebSocket | Provider only (Alchemy, Blockdaemon, QuickNode) | docs.arc.io connect-to-arc |
| Explorers | https://explorer.arc.io, https://explorer.testnet.arc.io | docs.arc.io connect-to-arc |
| Testnet faucet | https://faucet.circle.com | docs.arc.io connect-to-arc |
| USDC ERC-20 interface | `0x3600000000000000000000000000000000000000` on both networks, symbol `USDC`, **6 decimals** | `decimals()` and `symbol()` calls on both RPCs |
| Native gas token | USDC with **18 decimals**, same balance as the ERC-20 interface | docs.arc.io EVM differences |
| Gas price observed | Mainnet 20 gwei, testnet 25 gwei | `eth_gasPrice` on both RPCs |
| Fee floor | Mempool rejects `maxFeePerGas` below 20 gwei | docs.arc.io EVM differences |
| Zero address | Native sends to `address(0)` revert | docs.arc.io EVM differences |
| Blocklist | A blocklisted transfer reverts, uses gas and produces no receipt | docs.arc.io EVM differences |
| Finality | Deterministic, under one second, no reorgs | docs.arc.io |
| Privacy (APS) | Roadmap only, not available | docs.arc.io opt-in privacy |
| Circle developer-controlled wallets | Chain codes `ARC` and `ARC-TESTNET`, EOA and SCA | developers.circle.com supported blockchains |
| Circle Gas Station on Arc | Not confirmed | No source found. Do not depend on it. |
| **Stage 0 test tx** | hash `0xed553b0dc48fd49a07990bfaab723fb30c80b860c6fd3d6d418ad41d66ceda4c` · Circle id `b5e09b4f-ecd9-5ec7-930e-6d6ad9aceb9c` · request→COMPLETE **2220 ms** · gas used: see explorer | `approve(address,uint256)` from player_white wallet on ARC-TESTNET, 2026-10-08. Circle `feeLevel=HIGH`. Transaction went `INITIATED→COMPLETE` in a single 2 s poll tick — no intermediate `SENT` state observed, consistent with sub-second Arc finality. Explorer: https://explorer.testnet.arc.io/tx/0xed553b0dc48fd49a07990bfaab723fb30c80b860c6fd3d6d418ad41d66ceda4c |

## Rules that follow from these facts

1. All contract amounts are ERC-20 USDC with 6 decimals. Never mix them with
   native 18-decimal values in one calculation. Name variables `usdc6` or
   `native18` when both appear in one file.
2. Every outbound transaction sets `maxFeePerGas` of at least 20 gwei. Circle's
   `feeLevel` handles this; verify on the first testnet transaction.
3. Treat a transaction with no receipt as failed, not pending, after a timeout.
4. A move costs roughly 30k to 60k gas. At 20 gwei that is about $0.0006 to
   $0.0012. An 80-ply game is roughly 5 to 10 cents. Measure it in Stage 0 and
   write the measured numbers here.
