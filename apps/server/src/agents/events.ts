/**
 * Per-agent event queue for REST long-poll (`GET /v1/agent/next?wait=25`).
 * Events are stored in Redis as a list keyed by agentId.
 * TTL 5 minutes per entry; each agent's queue is capped at 100 entries.
 *
 * IMPORTANT: BRPOP is a blocking call. Using it on the shared redis client
 * blocks ALL other commands (clocks, pubsub, queues) for the duration of
 * the wait.  We use a DEDICATED connection so long-polls cannot starve the
 * rest of the server.  wait is clamped to 1–25 s to prevent indefinite
 * blocks and to satisfy Redis BRPOP's minimum 1 s timeout.
 */
import { redis } from "../db/redis.ts";

// One dedicated connection per server process, used only for BRPOP.
// Created lazily on first call.
let blockingConn: typeof redis | null = null;
function getBlockingConn(): typeof redis {
  if (!blockingConn) {
    blockingConn = redis.duplicate();
  }
  return blockingConn;
}

const QUEUE_KEY = (agentId: string) => `agent:events:${agentId}`;
const MAX_EVENTS = 100;
const EVENT_TTL_S = 300; // 5 min

const MIN_WAIT_S = 1;
const MAX_WAIT_S = 25;

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

/** Long-poll: wait up to `waitSec` (clamped to 1–25) for an event, then return. */
export async function waitForEvent(agentId: string, waitSec: number): Promise<unknown | null> {
  const clamped = Math.max(MIN_WAIT_S, Math.min(MAX_WAIT_S, Math.floor(waitSec)));
  const result = await getBlockingConn().brpop(QUEUE_KEY(agentId), clamped);
  if (!result) return null;
  return JSON.parse(result[1]);
}
