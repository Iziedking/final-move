import type React from "react";
import type { Metadata } from "next";
import { ProfileClient } from "@/components/ProfileClient";
import { serverApiBase } from "@/lib/api";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id} — Final Move` };
}

export default async function ProfilePage({ params }: Props): Promise<React.JSX.Element> {
  const { id }  = await params;
  const base    = serverApiBase();
  let   data    = null;
  try {
    const res = await fetch(`${base}/v1/profile/${id}`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(4_000),
    });
    if (res.ok) data = await res.json();
  } catch { /* server not reachable at build time */ }

  return <ProfileClient playerId={id} initialData={data} />;
}
