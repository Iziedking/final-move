/**
 * Run all migrations in order. Idempotent – safe to re-run.
 * Usage:  bun run migrate   (from apps/server)
 */
import { sql } from "./client.ts";
import { migrations } from "./migrations.ts";

/** Run migrations and close the connection (used when running as a standalone script). */
async function migrate() {
  await runMigrations();
  await sql.end();
}

/** Run all pending migrations. Does NOT close the connection — use this from the server startup. */
export async function runMigrations() {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id   serial PRIMARY KEY,
      name text    NOT NULL UNIQUE,
      ran_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const ran = await sql<{ name: string }[]>`SELECT name FROM _migrations`;
  const ranSet = new Set(ran.map((r) => r.name));

  for (const m of migrations) {
    if (ranSet.has(m.name)) continue;
    console.log(`  ↳ ${m.name}`);
    await sql.unsafe(m.sql);
    await sql`INSERT INTO _migrations (name) VALUES (${m.name})`;
  }

  console.log("[migrate] done");
}

// Standalone script entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
