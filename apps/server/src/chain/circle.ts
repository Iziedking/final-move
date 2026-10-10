/**
 * Thin wrapper over the Circle developer-controlled wallets REST API.
 * All calls use fetch directly to avoid ESM/CJS bundling issues with the SDK.
 */
import { cfg } from "../config/index.ts";
import { createHash } from "crypto";
import { webcrypto } from "node:crypto";

const BASE = "https://api.circle.com/v1/w3s";

async function circlePost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.CIRCLE_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { data?: T; code?: number; message?: string };
  if (!res.ok) throw new Error(`Circle ${path} ${res.status}: ${JSON.stringify(json)}`);
  return json.data as T;
}

async function circleGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${cfg.CIRCLE_API_KEY}` },
  });
  const json = await res.json() as { data?: T; code?: number; message?: string };
  if (!res.ok) throw new Error(`Circle GET ${path} ${res.status}: ${json.message ?? JSON.stringify(json)}`);
  return json.data as T;
}

// ── Entity secret ciphertext ─────────────────────────────────────────────────

async function buildEntitySecretCiphertext(): Promise<string> {
  // Fetch Circle's RSA public key
  const data = await circleGet<{ publicKey: string }>("/config/entity/publicKey");
  const pemKey = data.publicKey;

  // Import RSA-OAEP public key
  const pem = pemKey.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Buffer.from(pem, "base64");
  const cryptoKey = await webcrypto.subtle.importKey(
    "spki",
    der,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );

  // The entity secret as 32 bytes hex → Buffer
  const secretHex = cfg.ENTITY_SECRET.replace(/^0x/, "").padStart(64, "0");
  const secretBuf = Buffer.from(secretHex, "hex");

  const encrypted = await webcrypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    cryptoKey,
    secretBuf,
  );

  return Buffer.from(encrypted).toString("base64");
}

// Never cache: Circle requires a fresh ciphertext per request.
async function ciphertext() {
  return buildEntitySecretCiphertext();
}

// ── Wallet helpers ────────────────────────────────────────────────────────────

export interface CircleWallet {
  id: string;
  address: string;
  blockchain: string;
  state: string;
}

export async function createWallet(
  idempotencyKey: string,
  count = 1,
): Promise<CircleWallet[]> {
  const ct = await ciphertext();
  const data = await circlePost<{ wallets: CircleWallet[] }>("/developer/wallets", {
    idempotencyKey,
    entitySecretCiphertext: ct,
    blockchains: [cfg.CIRCLE_CHAIN],
    count,
    walletSetId: cfg.CIRCLE_WALLET_SET_ID,
    accountType: "EOA",
  });
  return data.wallets;
}

export interface TokenBalance {
  token: { symbol: string; decimals: number; tokenAddress?: string };
  amount: string;
}

export async function getWalletBalances(walletId: string): Promise<TokenBalance[]> {
  const data = await circleGet<{ tokenBalances: TokenBalance[] }>(
    `/wallets/${walletId}/balances`,
  );
  return data.tokenBalances ?? [];
}

export async function getUsdcBalance(walletId: string): Promise<bigint> {
  const bals = await getWalletBalances(walletId);
  const usdc = bals.find((b) => b.token.tokenAddress?.toLowerCase() === cfg.USDC_ADDRESS.toLowerCase()
    || b.token.symbol === "USDC");
  if (!usdc) return 0n;
  return BigInt(Math.round(parseFloat(usdc.amount) * 1_000_000));
}

// ── Transaction helpers ───────────────────────────────────────────────────────

export interface CircleTx {
  id: string;
  state: string;
  txHash?: string;
  blockHash?: string;
  blockHeight?: number;
}

export async function createContractExecution(opts: {
  idempotencyKey: string;
  walletId: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: unknown[];
  feeLevel?: "LOW" | "MEDIUM" | "HIGH";
}): Promise<CircleTx> {
  const ct = await ciphertext();
  const res = await fetch(`${BASE}/developer/transactions/contractExecution`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.CIRCLE_API_KEY}`,
    },
    body: JSON.stringify({
      idempotencyKey: opts.idempotencyKey,
      entitySecretCiphertext: ct,
      walletId: opts.walletId,
      contractAddress: opts.contractAddress,
      abiFunctionSignature: opts.abiFunctionSignature,
      abiParameters: opts.abiParameters,
      feeLevel: opts.feeLevel ?? "HIGH",
    }),
  });
  // contractExecution returns { data: { id, state, ... } } directly (not nested under "transaction")
  const json = await res.json() as { data?: CircleTx & { transaction?: CircleTx }; code?: number; message?: string };
  if (!res.ok) throw new Error(`Circle /developer/transactions/contractExecution ${res.status}: ${json.message ?? JSON.stringify(json)}`);
  const tx = json.data?.transaction ?? json.data;
  if (!tx?.id) throw new Error(`Circle contractExecution: unexpected response: ${JSON.stringify(json)}`);
  return tx;
}

export async function createTokenTransfer(opts: {
  idempotencyKey: string;
  sourceWalletId: string;
  destinationAddress: string;
  tokenAddress: string;
  amount: string;            // decimal string e.g. "0.25"
  feeLevel?: "LOW" | "MEDIUM" | "HIGH";
}): Promise<CircleTx> {
  const ct = await ciphertext();
  const res = await fetch(`${BASE}/developer/transactions/transfer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.CIRCLE_API_KEY}`,
    },
    body: JSON.stringify({
      idempotencyKey: opts.idempotencyKey,
      entitySecretCiphertext: ct,
      walletId: opts.sourceWalletId,
      amounts: [opts.amount],
      destinationAddress: opts.destinationAddress,
      tokenAddress: opts.tokenAddress,
      blockchain: cfg.CIRCLE_CHAIN,
      feeLevel: opts.feeLevel ?? "MEDIUM",
    }),
  });
  // Transfer endpoint returns { data: { id, state, ... } } (not nested under "transaction")
  const json = await res.json() as { data?: CircleTx & { transaction?: CircleTx }; code?: number; message?: string };
  if (!res.ok) throw new Error(`Circle transfer ${res.status}: ${JSON.stringify(json)}`);
  const tx = json.data?.transaction ?? json.data;
  if (!tx?.id) throw new Error(`Circle transfer: unexpected response: ${JSON.stringify(json)}`);
  return tx;
}

export async function getTxStatus(txId: string): Promise<CircleTx> {
  const res = await fetch(`${BASE}/transactions/${txId}`, {
    headers: { Authorization: `Bearer ${cfg.CIRCLE_API_KEY}` },
  });
  // GET /transactions/:id returns { data: { id, state, ... } } directly
  const json = await res.json() as { data?: CircleTx & { transaction?: CircleTx }; code?: number; message?: string };
  if (!res.ok) throw new Error(`Circle GET /transactions/${txId} ${res.status}: ${JSON.stringify(json)}`);
  const tx = json.data?.transaction ?? json.data;
  if (!tx?.id) throw new Error(`Circle getTxStatus: unexpected response: ${JSON.stringify(json)}`);
  return tx;
}

/** Poll until complete/failed/cancelled or timeout. Returns final state. */
export async function pollTx(
  txId: string,
  timeoutMs = 60_000,
  intervalMs = 2_000,
): Promise<CircleTx> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tx = await getTxStatus(txId);
    if (["COMPLETE", "FAILED", "DENIED", "CANCELLED"].includes(tx.state)) return tx;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`tx ${txId} timed out after ${timeoutMs}ms`);
}

// ── UUID v5 for idempotency keys ──────────────────────────────────────────────

const NAMESPACE_OID = "6ba7b812-9dad-11d1-80b4-00c04fd430c8";
function namespaceBytes(ns: string): Buffer {
  return Buffer.from(ns.replace(/-/g, ""), "hex");
}

export function uuidV5(name: string): string {
  const nsBuf = namespaceBytes(NAMESPACE_OID.replace(/-/g, ""));
  const nameBuf = Buffer.from(name, "utf8");
  const hash = createHash("sha1").update(Buffer.concat([nsBuf, nameBuf])).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80; // variant
  const h = hash.subarray(0, 16).toString("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}
