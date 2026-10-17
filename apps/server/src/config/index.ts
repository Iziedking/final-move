import { z } from "zod";

const Env = z.object({
  NODE_ENV:              z.string().default("development"),
  PORT:                  z.coerce.number().default(3001),
  NETWORK:               z.enum(["testnet", "mainnet"]).default("testnet"),
  ARC_RPC_URL:           z.string().url(),
  ARC_WS_URL:            z.string(),
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
});

function loadEnv() {
  const result = Env.safeParse(process.env);
  if (!result.success) {
    console.error("❌  Invalid environment:\n", result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const cfg = loadEnv();

export const TOPUP_THRESHOLD_USDC6 = BigInt(Math.round(cfg.TOPUP_THRESHOLD_USDC * 1_000_000));
export const TOPUP_AMOUNT_USDC6    = BigInt(Math.round(cfg.TOPUP_AMOUNT_USDC    * 1_000_000));
export const TOPUP_DAILY_CAP_USDC6 = BigInt(Math.round(cfg.TOPUP_DAILY_CAP_USDC * 1_000_000));
