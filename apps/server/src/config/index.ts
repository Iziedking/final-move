import { z } from "zod";

const Env = z.object({
  NODE_ENV:              z.string().default("development"),
  PORT:                  z.coerce.number().default(3001),
  NETWORK:               z.enum(["testnet", "mainnet"]).default("testnet"),
  ARC_RPC_URL:           z.string().url(),
  ARC_WS_URL:            z.string().default(""),     // unused; mainnet WebSocket is provider-only
  ARC_EXPLORER:          z.string().url(),
  CIRCLE_CHAIN:          z.string(),
  USDC_ADDRESS:          z.string(),
  CIRCLE_API_KEY:        z.string().min(1),
  ENTITY_SECRET:         z.string().min(1),
  CIRCLE_WALLET_SET_ID:  z.string().min(1),
  REFEREE_WALLET_ID:      z.string().min(1),
  REFEREE_WALLET_ADDRESS: z.string().min(1, "REFEREE_WALLET_ADDRESS is required"),
  TREASURY_WALLET_ID:     z.string().min(1),
  CIRCLE_WEBHOOK_PUBLIC_KEY_URL: z.string().default(""),
  LEDGER_ADDRESS:        z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  ESCROW_ADDRESS:        z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  POOL_ADDRESS:          z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  DEPLOY_BLOCK:          z.coerce.bigint(),
  DATABASE_URL:          z.string().url(),
  REDIS_URL:             z.string(),
  TOPUP_THRESHOLD_USDC:  z.coerce.number().default(0.10),
  TOPUP_AMOUNT_USDC:     z.coerce.number().default(0.25),
  TOPUP_DAILY_CAP_USDC:  z.coerce.number().default(25),
  SESSION_SECRET:        z.string().min(32).default("dev-session-secret-change-me-at-least-32c"),
  ADMIN_TOKEN:           z.string().default(""),         // required in prod; empty = admin routes disabled
  INTERNAL_SECRET:       z.string().default(""),         // shared secret for web→api server-to-server calls
  PUBLIC_WEB_URL:        z.string().default("http://localhost:3000"),
  // Comma-separated list of bot wallet IDs (set after create-bot-wallets runs)
  BOT_WALLET_IDS:        z.string().default(""),
  // Guest games per UTC day across all guests (0 = unlimited). Guests cost real
  // gas on mainnet, so the default there is 50; testnet is unlimited.
  MAX_GUEST_GAMES_PER_DAY: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(0).optional()),
  // Withdrawal limits
  WITHDRAW_MIN_USDC:       z.coerce.number().default(0.10),
  WITHDRAW_DAILY_CAP_USDC: z.coerce.number().default(100),
});

function loadEnv() {
  const result = Env.safeParse(process.env);
  if (!result.success) {
    console.error("❌  Invalid environment:\n", result.error.flatten().fieldErrors);
    process.exit(1);
  }
  const env = result.data;
  // Mainnet must point at mainnet everywhere; a mixed setup would sign real
  // transactions against the wrong chain or contracts.
  if (env.NETWORK === "mainnet") {
    const problems: string[] = [];
    if (env.CIRCLE_CHAIN !== "ARC") problems.push(`CIRCLE_CHAIN must be "ARC" on mainnet (got "${env.CIRCLE_CHAIN}")`);
    if (/testnet/i.test(env.ARC_RPC_URL)) problems.push("ARC_RPC_URL points at testnet");
    if (/testnet/i.test(env.ARC_EXPLORER)) problems.push("ARC_EXPLORER points at testnet");
    for (const k of ["LEDGER_ADDRESS", "ESCROW_ADDRESS", "POOL_ADDRESS"] as const) {
      if (/^0x0{40}$/i.test(env[k])) problems.push(`${k} is the zero address`);
    }
    if (env.DEPLOY_BLOCK <= 0n) problems.push("DEPLOY_BLOCK must be the mainnet deploy block");
    if (env.ADMIN_TOKEN.length < 32) problems.push("ADMIN_TOKEN must be set (32+ chars)");
    if (env.INTERNAL_SECRET.length < 32) problems.push("INTERNAL_SECRET must be set (32+ chars)");
    if (env.SESSION_SECRET.startsWith("dev-session-secret")) problems.push("SESSION_SECRET must be set");
    if (problems.length) {
      console.error("❌  Mainnet configuration refused:\n - " + problems.join("\n - "));
      process.exit(1);
    }
  }
  return {
    ...env,
    MAX_GUEST_GAMES_PER_DAY: env.MAX_GUEST_GAMES_PER_DAY ?? (env.NETWORK === "mainnet" ? 50 : 0),
  };
}

export const cfg = loadEnv();

export const TOPUP_THRESHOLD_USDC6  = BigInt(Math.round(cfg.TOPUP_THRESHOLD_USDC * 1_000_000));
export const TOPUP_AMOUNT_USDC6     = BigInt(Math.round(cfg.TOPUP_AMOUNT_USDC    * 1_000_000));
export const TOPUP_DAILY_CAP_USDC6  = BigInt(Math.round(cfg.TOPUP_DAILY_CAP_USDC * 1_000_000));
export const WITHDRAW_MIN_USDC6     = BigInt(Math.round(cfg.WITHDRAW_MIN_USDC     * 1_000_000));
export const WITHDRAW_DAILY_CAP_USDC6 = BigInt(Math.round(cfg.WITHDRAW_DAILY_CAP_USDC * 1_000_000));
// The gas reserve held back from withdrawable balance — same as the top-up amount.
export const WITHDRAW_GAS_RESERVE_USDC6 = TOPUP_AMOUNT_USDC6;
