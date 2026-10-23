import Link from "next/link";
import type React from "react";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";

export default function NotFound(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center gap-5 px-4 py-16 text-center">
        <span
          className="font-display text-[72px] font-extrabold leading-none"
          style={{ color: "rgb(var(--violet))", transform: "rotate(-4deg)", display: "inline-block" }}
          aria-hidden
        >
          404
        </span>
        <h1 className="font-display text-[36px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>
          This square is empty
        </h1>
        <p className="text-[17px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>
          The page or game you are looking for does not exist, or the link has expired.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/" className="pop-btn px-6 text-[16px]">Play a game</Link>
          <Link href="/watch" className="pop-btn pop-btn-ghost px-6 text-[16px]">Watch live</Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
