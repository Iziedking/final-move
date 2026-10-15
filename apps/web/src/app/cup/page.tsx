import React, { Suspense } from "react";
import CupClient from "./CupClient";

export const metadata = { title: "Saturday Cup - Final Move" };
export const dynamic = "force-dynamic";

export default function CupPage(): React.JSX.Element {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-zinc-400">Loading…</div>}>
      <CupClient />
    </Suspense>
  );
}
