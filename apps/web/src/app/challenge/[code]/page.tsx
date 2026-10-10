import type React from "react";
import { ChallengeAcceptClient } from "./ChallengeAcceptClient";

export default async function ChallengeAcceptPage(
  props: { params: Promise<{ code: string }> },
): Promise<React.JSX.Element> {
  const { code } = await props.params;
  return <ChallengeAcceptClient code={code} />;
}
