/**
 * Per-agent event queue for REST long-poll (`GET /v1/agent/next?wait=25`).
 * Events are stored in Redis as a list keyed by agentId.
 * TTL 5 minutes per entry; each agent's queue is capped at 100 entries.
 */
import { redis } from "../db/redis.ts";

const QUEUE_KEY = (agentId: string) => `agent:events:${agentId}`;
const MAX_EVENTS = 100;
const EVENT_TTL_S = 300; // 5 min

/** Push an event to an agent's queue. */
export async function pushEvent(agentId: string, event: unknown): Promise<void> {
  const key = QUEUE_KEY(agentId);
  await redis.lpush(key, JSON.stringify(event));
  await redis.ltrim(key, 0, MAX_EVENTS - 1);
  await redis.expire(key, EVENT_TTL_S);
}

/** Pop the next event synchronously, or null if empty. */
export async function popEvent(agentId: string): Promise<unknown | null> {
  const raw = await redis.rpop(QUEUE_KEY(agentId));
  return raw ? JSON.parse(raw) : null;
}

/** Long-poll: wait up to `waitSec` for an event, then return. */
export async function waitForEvent(agentId: string, waitSec: number): Promise<unknown | null> {
  const result = await redis.brpop(QUEUE_KEY(agentId), waitSec);
  if (!result) return null;
  return JSON.parse(result[1]);
}
