import type React from "react";
import { LeaderboardClient } from "./LeaderboardClient";

export const metadata = {
  title: "Leaderboard - Final Move",
};

export default function LeaderboardPage(): React.JSX.Element {
  return <LeaderboardClient />;
}
