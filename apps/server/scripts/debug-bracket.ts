import { sql } from "../src/db/client.ts";
import { isComplete } from "@final-move/chess";

const rows = await sql<{ id: string; status: string; bracket_json: string | null }[]>`
  SELECT id, status, bracket_json FROM tournaments ORDER BY created_at DESC LIMIT 3
`;
for (const t of rows) {
  console.log("tournament:", t.id, "status:", t.status);
  if (!t.bracket_json) { console.log("  NO BRACKET"); continue; }
  const parsed = JSON.parse(t.bracket_json);
  const bracket = parsed.bracket;
  console.log("  isComplete:", isComplete(bracket));
  for (const round of bracket.rounds) {
    for (const m of round) {
      console.log(`  r${m.round}m${m.index}: a=${m.a} b=${m.b} winner=${m.winner}`);
    }
  }
}

const tg = await sql`SELECT * FROM tournament_games ORDER BY round, match_index`;
console.log("\ntournament_games:", JSON.stringify(tg));
await sql.end();
