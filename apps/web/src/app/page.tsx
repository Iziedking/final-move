import { HomeClient } from "@/components/HomeClient";
import { auth } from "@/auth";

import type React from "react";
export default async function HomePage(): Promise<React.JSX.Element> {
  const session = await auth();
  return <HomeClient session={session} />;
}
