/** The five house bots, weakest first. Names and strengths match the server's bot table. */
export const BOTS = [
  { id: "bot_1", name: "Pawnderer",  desc: "Learning the ropes. A friendly first game.", elo: "~600" },
  { id: "bot_2", name: "Knightfall", desc: "Plays fast and likes surprises.",            elo: "~900" },
  { id: "bot_3", name: "Rookery",    desc: "Solid and patient. Punishes loose pieces.",   elo: "~1200" },
  { id: "bot_4", name: "Bishopric",  desc: "Sees tactics two moves ahead.",               elo: "~1500" },
  { id: "bot_5", name: "GrandBot",   desc: "Full engine strength. Bring your best.",      elo: "~1900" },
] as const;

export type BotId = (typeof BOTS)[number]["id"];

export function botName(id: string): string | undefined {
  return BOTS.find((b) => b.id === id)?.name;
}
