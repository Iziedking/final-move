import { Hono }          from "hono";

import { handleWebhook } from "../chain/writer.ts";
import { cfg }           from "../config/index.ts";

export const webhookRouter = new Hono();

// Cache the Circle entity public key so we only fetch it once per process.
let cachedPublicKey: string | null = null;
async function getPublicKey(): Promise<string> {
  if (cachedPublicKey) return cachedPublicKey;
  const res = await fetch(cfg.CIRCLE_WEBHOOK_PUBLIC_KEY_URL, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`Failed to fetch Circle public key: ${res.status}`);
  const data = await res.json() as { publicKey: string };
  cachedPublicKey = data.publicKey;
  return cachedPublicKey;
}

/**
 * Verify Circle's X-Circle-Signature header.
 * Circle uses RSA-SHA256: the header is base64(RSA_PKCS1_SIGN(sha256(body))).
 * We import Circle's public key (fetched from CIRCLE_WEBHOOK_PUBLIC_KEY_URL)
 * and verify using the Web Crypto API available in Bun.
 */
async function verifyCircleSignature(
  rawBody: string,
  signature: string,
): Promise<boolean> {
  try {
    const publicKeyPem = await getPublicKey();

    // Strip PEM headers and decode base64
    const pemBody = publicKeyPem
      .replace("-----BEGIN PUBLIC KEY-----", "")
      .replace("-----END PUBLIC KEY-----", "")
      .replace(/\s/g, "");
    const keyBytes = Buffer.from(pemBody, "base64");

    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      keyBytes,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const sigBytes  = Buffer.from(signature, "base64");
    const bodyBytes = new TextEncoder().encode(rawBody);

    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, sigBytes, bodyBytes);
  } catch (e) {
    console.error("[webhook] signature verification error:", (e as Error).message);
    return false;
  }
}

webhookRouter.post("/", async (c) => {
  const rawBody  = await c.req.text();
  const sig      = c.req.header("X-Circle-Signature") ?? "";

  if (sig) {
    const valid = await verifyCircleSignature(rawBody, sig);
    if (!valid) {
      console.warn("[webhook] invalid Circle signature — rejected");
      return c.json({ error: "invalid_signature" }, 401);
    }
  } else if (process.env.NODE_ENV === "production") {
    // Require signature in production; accept unsigned in dev/test
    console.warn("[webhook] missing Circle signature in production — rejected");
    return c.json({ error: "missing_signature" }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  await handleWebhook(body);
  return c.json({ ok: true });
});
