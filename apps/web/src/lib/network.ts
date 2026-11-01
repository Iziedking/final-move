/**
 * Which Arc network this build talks to. Set NEXT_PUBLIC_NETWORK=mainnet for
 * the public launch; everything else (explorer links, faucet, stakes, copy)
 * follows from it. NEXT_PUBLIC_ARC_EXPLORER overrides the explorer base.
 */
export type ArcNetwork = "testnet" | "mainnet";

export const NETWORK: ArcNetwork = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const IS_MAINNET = NETWORK === "mainnet";

/** Explorer base URL, no trailing slash. */
export const ARC_EXPLORER: string = (
  process.env.NEXT_PUBLIC_ARC_EXPLORER ||
  (IS_MAINNET ? "https://explorer.arc.io" : "https://explorer.testnet.arc.io")
).replace(/\/$/, "");

/** "Arc mainnet" or "Arc testnet", for copy. */
export const NETWORK_LABEL = IS_MAINNET ? "Arc mainnet" : "Arc testnet";

/** Stakes exist on testnet only; mainnet contracts are deployed with stakes switched off. */
export const STAKES_ENABLED = !IS_MAINNET;
