import type React from "react";
import type { Metadata } from "next";
import { ReplayClient } from "@/components/ReplayClient";
import { serverApiBase } from "@/lib/api";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const base = serverApiBase();
  try {
    const res = await fetch(`${base}/v1/games/${id}/share`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return { title: "Replay — Final Move" };
    const d = await res.json() as {
      whiteName: string; blackName: string; resultLabel: string;
      moveCount: number; gameId: string;
    };
    const title       = `${d.whiteName} vs ${d.blackName} — ${d.resultLabel} | Final Move`;
    const description = `${d.moveCount} moves on Arc. Every move is onchain.`;
    const ogUrl       = `${base}/v1/games/${id}/og-image`;
    return {
      title,
      description,
      openGraph: { title, description, images: [{ url: ogUrl, width: 1200, height: 630 }] },
      twitter:   { card: "summary_large_image", title, description, images: [ogUrl] },
    };
  } catch {
    return { title: "Replay — Final Move" };
  }
}

export default async function ReplayPage({ params }: Props): Promise<React.JSX.Element> {
  const { id }   = await params;
  const base     = serverApiBase();
  let   data     = null;
  try {
    const res = await fetch(`${base}/v1/games/${id}/replay`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(4_000),
    });
    if (res.ok) data = await res.json();
  } catch { /* server not reachable at build time */ }

  return <ReplayClient gameId={id} initialData={data} />;
}
