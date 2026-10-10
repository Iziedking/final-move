import { Hono } from "hono";
import { handleWebhook } from "../chain/writer.ts";

export const webhookRouter = new Hono();

webhookRouter.post("/", async (c) => {
  // TODO: verify X-Circle-Signature using cfg.CIRCLE_WEBHOOK_PUBLIC_KEY_URL
  const body = await c.req.json();
  await handleWebhook(body);
  return c.json({ ok: true });
});
