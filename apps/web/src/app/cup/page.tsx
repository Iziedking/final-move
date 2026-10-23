import React, { Suspense } from "react";
import CupClient from "./CupClient";

export const metadata = { title: "Saturday Cup" };
export const dynamic = "force-dynamic";

export default function CupPage(): React.JSX.Element {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center font-bold" style={{ background: "rgb(var(--sky))", color: "rgb(var(--ink-3))" }}>Loading the cup…</div>}>
      <CupClient />
    </Suspense>
  );
}
