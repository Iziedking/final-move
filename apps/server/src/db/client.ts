import postgres from "postgres";
import { cfg } from "../config/index.ts";

export const sql = postgres(cfg.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
});
