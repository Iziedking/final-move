/**
 * Run all migrations in order. Idempotent – safe to re-run.
 * Each migration runs inside its own transaction with an advisory lock so
 * concurrent restarts never double-apply a migration.
 * Usage:  bun run migrate   (from apps/server)
 */
import { sql } from "./client.ts";
import { migrations } from "./migrations.ts";

const ADVISORY_LOCK_ID = 8675309; // arbitrary stable int for this app

/** Run migrations and close the connection (used when running as a standalone script). */
async function migrate() {
  await runMigrations();
  await sql.end();
}

/** Run all pending migrations. Does NOT close the connection — use this from the server startup. */
export async function runMigrations() {
  // Ensure the tracking table exists outside the advisory lock
  // (so the lock query itself can read it)
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id     serial PRIMARY KEY,
      name   text   NOT NULL UNIQUE,
      ran_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  // Acquire an exclusive advisory lock for the duration of the migration run.
  // Any concurrent server startup will wait here until we release.
  await sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_ID})`;

  try {
    const ran = await sql<{ name: string }[]>`SELECT name FROM _migrations`;
    const ranSet = new Set(ran.map((r) => r.name));

    for (const m of migrations) {
      if (ranSet.has(m.name)) continue;
      console.log(`  ↳ running ${m.name}`);

      // Each migration + its tracking record go in one transaction
      await sql.begin(async (tx) => {
        await tx.unsafe(m.sql);
        await tx`INSERT INTO _migrations (name) VALUES (${m.name})`;
      });

      console.log(`  ↳ done    ${m.name}`);
    }
  } finally {
    // Always release the lock — even if a migration fails
    await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`;
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
