import type React from "react";
import { PlayClient } from "./PlayClient";

export const metadata = { title: "Find a game" };

export default function PlayPage(): React.JSX.Element {
  return <PlayClient />;
}
