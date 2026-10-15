import type React from "react";
import { auth } from "@/auth";
import { AgentsClient } from "./AgentsClient";

export const metadata = { title: "Agents - Final Move" };

export default async function AgentsPage(): Promise<React.JSX.Element> {
  const session = await auth();
  return <AgentsClient session={session} />;
}
