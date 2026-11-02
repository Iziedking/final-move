import type React from "react";
import { auth } from "@/auth";
import { ConnectClient } from "./ConnectClient";

export const metadata = { title: "Connect an app" };

export default async function ConnectPage(
  props: { searchParams: Promise<{ request?: string }> },
): Promise<React.JSX.Element> {
  const [{ request }, session] = await Promise.all([props.searchParams, auth()]);
  return <ConnectClient requestId={request ?? ""} userId={session?.user?.id ?? null} />;
}
