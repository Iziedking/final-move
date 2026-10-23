"use client";
import Link from "next/link";
import type React from "react";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): React.JSX.Element {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "rgb(var(--sky))" }}>
      <div className="sticker-card-lg flex w-full max-w-[440px] flex-col items-center gap-4 p-7 text-center">
        <h1 className="font-display text-[32px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>
          Something went wrong
        </h1>
        <p className="text-[16px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>
          This page hit an error. Any game in progress is safe on the server; reload to get back to it.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={reset} className="pop-btn px-6 text-[16px]">Try again</button>
          <Link href="/" className="pop-btn pop-btn-ghost px-6 text-[16px]">Home</Link>
        </div>
        {error.digest && <p className="font-mono text-[11px]" style={{ color: "rgb(var(--ink-3))" }}>Ref {error.digest}</p>}
      </div>
    </div>
  );
}
