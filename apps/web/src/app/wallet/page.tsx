import type React from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import WalletClient from "./WalletClient";

export const metadata = { title: "Wallet - Final Move" };

export default async function WalletPage(): Promise<React.JSX.Element> {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  return <WalletClient userId={session.user.id} />;
}
