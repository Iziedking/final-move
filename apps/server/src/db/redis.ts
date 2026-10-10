import { Redis } from "ioredis";
import { cfg } from "../config/index.ts";

export const redis = new Redis(cfg.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
  lazyConnect: false,
});

redis.on("error", (e: Error) => console.error("[redis]", e.message));
