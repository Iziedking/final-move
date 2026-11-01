"use client";
/**
 * The app chrome on every page except the game screen: wordmark, the main
 * sections, theme and the X sign-in. On phones the sections become a
 * scrollable row of chips under the wordmark.
 */
import Link from "next/link";
import Image from "next/image";
import type React from "react";
import { usePathname } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { King } from "@/components/ChessPieces";
import { NETWORK_LABEL } from "@/lib/network";

const NAV = [
  { href: "/", label: "Play" },
  { href: "/watch", label: "Watch" },
  { href: "/cup", label: "Saturday Cup" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/agents", label: "Agents" },
] as const;

export function Wordmark({ size = 22 }: { size?: number }): React.JSX.Element {
  return (
    <Link href="/" className="inline-flex items-center gap-2" aria-label="Final Move home">
      <span
        className="grid shrink-0 place-items-center"
        style={{
          width: size + 12, height: size + 12,
          background: "rgb(var(--violet))",
          border: "2.5px solid rgb(var(--ink))",
          borderRadius: 11,
          boxShadow: "2px 2px 0 rgb(var(--pop-shadow))",
          transform: "rotate(-4deg)",
        }}
        aria-hidden
      >
        <span className="block" style={{ width: size + 4, height: size + 4 }}><King c="w" /></span>
      </span>
      <span className="font-display font-extrabold leading-none" style={{ fontSize: size, color: "rgb(var(--ink))" }}>
        Final <span style={{ color: "rgb(var(--violet))" }}>Move</span>
      </span>
    </Link>
  );
}

export function SiteHeader(): React.JSX.Element {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const user = session?.user;
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const links = [...NAV, ...(user ? [{ href: "/wallet", label: "Wallet" }] : [])];

  return (
    <header className="relative z-20 w-full">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 pt-4 sm:px-6 lg:px-10">
        <Wordmark />

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active(l.href) ? "page" : undefined}
              className="rounded-full px-3.5 py-2 text-[14px] font-extrabold transition-colors hover:bg-[rgb(var(--cloud))]"
              style={{
                color: "rgb(var(--ink))",
                background: active(l.href) ? "rgb(var(--cloud))" : undefined,
                boxShadow: active(l.href) ? "0 0 0 2px rgb(var(--ink)), 2px 2px 0 2px rgb(var(--pop-shadow))" : undefined,
              }}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle className="!h-9 !w-9" />
          {status === "loading" ? (
            <span className="h-9 w-24 rounded-full" style={{ background: "rgb(var(--sky-2))" }} aria-hidden />
          ) : user ? (
            <details className="relative">
              <summary
                className="flex min-h-[40px] cursor-pointer list-none items-center gap-2 rounded-full py-1 pl-1 pr-3 [&::-webkit-details-marker]:hidden"
                style={{ background: "rgb(var(--cloud))", border: "2px solid rgb(var(--ink))", boxShadow: "2px 2px 0 rgb(var(--pop-shadow))" }}
              >
                <span className="relative h-8 w-8 overflow-hidden rounded-full" style={{ border: "2px solid rgb(var(--ink))", background: "rgb(var(--sky-2))" }}>
                  {user.image ? <Image src={user.image} alt="" fill sizes="32px" className="object-cover" /> : null}
                </span>
                <span className="hidden max-w-[120px] truncate text-[14px] font-extrabold sm:inline" style={{ color: "rgb(var(--ink))" }}>
                  @{user.handle ?? user.name}
                </span>
              </summary>
              <div className="sticker-card-sm absolute right-0 top-[calc(100%+8px)] z-30 flex w-48 flex-col p-1.5">
                <Link href={`/profile/${user.id}`} className="rounded-xl px-3 py-2.5 text-[14px] font-extrabold hover:bg-[rgb(var(--sky-2))]">Profile</Link>
                <Link href="/wallet" className="rounded-xl px-3 py-2.5 text-[14px] font-extrabold hover:bg-[rgb(var(--sky-2))]">Wallet</Link>
                <Link href="/agents" className="rounded-xl px-3 py-2.5 text-[14px] font-extrabold hover:bg-[rgb(var(--sky-2))]">My agents</Link>
                <button type="button" onClick={() => signOut()} className="rounded-xl px-3 py-2.5 text-left text-[14px] font-extrabold hover:bg-[rgb(var(--sky-2))]" style={{ color: "rgb(var(--coral))" }}>
                  Sign out
                </button>
              </div>
            </details>
          ) : (
            <button type="button" onClick={() => signIn("twitter")} className="pop-btn min-h-[40px] px-4 text-[14px]">
              Sign in with X
            </button>
          )}
        </div>
      </div>

      <nav className="no-scrollbar mx-auto mt-3 flex max-w-[1440px] gap-2 overflow-x-auto px-4 pb-1.5 sm:px-6 lg:px-10 lg:hidden" aria-label="Main">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active(l.href) ? "page" : undefined}
            className="chip shrink-0 py-1.5 text-[13px]"
            style={{ background: active(l.href) ? "rgb(var(--violet))" : "rgb(var(--cloud))", color: active(l.href) ? "#fff" : "rgb(var(--ink))" }}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

/** Quiet footer with the facts that matter. */
export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="mx-auto mt-auto w-full max-w-[1440px] px-4 pb-8 pt-12 sm:px-6 lg:px-10">
      <div className="flex flex-col items-start justify-between gap-3 border-t-2 pt-5 text-[13px] font-bold sm:flex-row sm:items-center" style={{ borderColor: "rgb(var(--ink) / 0.12)", color: "rgb(var(--ink-3))" }}>
        <span>Final Move runs on {NETWORK_LABEL}. Moves cost gas in USDC, paid by the house.</span>
        <span className="flex gap-4">
          <Link href="/about" className="hover:underline">About and fair play</Link>
          <Link href="/leaderboard" className="hover:underline">Leaderboard</Link>
        </span>
      </div>
    </footer>
  );
}
