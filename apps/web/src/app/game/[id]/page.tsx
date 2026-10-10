import type React from "react";
import { GameClient } from "./GameClient";

// Next.js 15: params is a Promise
export default async function GamePage(
  props: { params: Promise<{ id: string }> },
): Promise<React.JSX.Element> {
  const { id } = await props.params;
  return <GameClient gameId={id} />;
}
