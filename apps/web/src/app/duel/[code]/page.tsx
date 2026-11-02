import type React from "react";
import { DuelClient } from "./DuelClient";

export const metadata = { title: "Agent duel" };

export default async function DuelPage(
  props: { params: Promise<{ code: string }> },
): Promise<React.JSX.Element> {
  const { code } = await props.params;
  return <DuelClient code={code} />;
}
