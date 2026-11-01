"use client";
import { API_BASE } from "@/lib/api";
import { apiFetch, describeError } from "@/lib/session";
import { useNames } from "@/lib/names";
import Link from "next/link";
import Image from "next/image";
import type React from "react";
import { useState, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";
import { King } from "@/components/ChessPieces";

interface Challenge {
  challengerId: string;
  gameClass:    string;
  timeControl:  string;
}

export function ChallengeAcceptClient({ code }: { code: string }): React.JSX.Element {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading]     = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [missing, setMissing]     = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/v1/challenges/${code}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("expired")))
      .then((d: Challenge) => setChallenge(d))
      .catch(() => setMissing(true))
      .finally(() => setLoading(false));
  }, [code]);

  const names = useNames(challenge ? [{ id: challenge.challengerId, kind: "user" }] : []);
  const who = challenge ? names[challenge.challengerId] : undefined;
  const signedIn = !!session?.user?.id;
  const own = signedIn && challenge?.challengerId === session?.user?.id;

  const handleAccept = async () => {
    if (!session?.user?.id) { setError("Sign in with X to accept this challenge."); return; }
    if (!challenge) return;
    setAccepting(true); setError(null);
    try {
      const res = await apiFetch(`/v1/challenges/${code}/accept`, { method: "POST" }, session.user.id);
      const data = await res.json() as { gameId?: string; color?: "w" | "b"; error?: string };
      if (!res.ok || !data.gameId) throw new Error(describeError(data.error));
      router.push(`/game/${data.gameId}?color=${data.color}`);
    } catch (e) {
      setError((e as Error).message);
      setAccepting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1440px] flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:px-10">
        <div className="sticker-card-lg w-full max-w-[440px] p-6 text-center" style={{ animation: "pop-in 240ms var(--spring) both" }} aria-live="polite">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="h-7 w-7 animate-spin rounded-full border-[3px]" style={{ borderColor: "rgb(var(--violet))", borderTopColor: "transparent" }} />
              <p className="font-display text-[20px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Opening the challenge…</p>
            </div>
          ) : missing || !challenge ? (
            <div className="flex flex-col items-center gap-4 py-2">
              <h1 className="font-display text-[30px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>This link has expired</h1>
              <p className="text-[15px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
                Challenge links work once and last 10 minutes. Ask your friend for a new one, or start a game of your own.
              </p>
              <div className="flex w-full flex-col gap-2.5">
                <Link href="/play" className="pop-btn min-h-[50px] w-full text-[16px]">Play a person</Link>
                <Link href="/" className="pop-btn pop-btn-ghost min-h-[48px] w-full text-[15px]">Play a bot</Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <span className="relative grid h-20 w-20 place-items-center overflow-hidden rounded-[22px]" style={{ background: "rgb(var(--violet))", border: "var(--line) solid rgb(var(--ink))", boxShadow: "4px 4px 0 rgb(var(--pop-shadow))", transform: "rotate(-4deg)" }}>
                  {who?.avatar ? <Image src={who.avatar} alt="" fill sizes="80px" className="object-cover" /> : <span className="block h-14 w-14"><King c="w" /></span>}
                </span>
              </div>
              <span className="chip" style={{ background: "rgb(var(--amber))", color: "rgb(var(--candy-ink))" }}>You have been challenged</span>
              <h1 className="font-display text-[30px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>
                {who?.name ?? "A player"} wants a game
              </h1>
              <div className="flex gap-2">
                <span className="chip" style={{ background: "rgb(var(--cloud-2))" }}>{challenge.timeControl.replace("+", " + ")}</span>
                <span className="chip" style={{ background: "rgb(var(--cloud-2))" }}>{challenge.gameClass === "human" ? "Human class" : "Open class"}</span>
                <span className="chip" style={{ background: "rgb(var(--mint))", color: "rgb(var(--candy-ink))" }}>Rated</span>
              </div>
              <p className="text-[14px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
                Colours are drawn at random. Every move is a transaction from your own wallet on Arc.
              </p>

              {error && (
                <p role="alert" className="w-full rounded-[var(--r)] px-3.5 py-2.5 text-[14px] font-bold" style={{ border: "2px solid rgb(var(--coral))", background: "rgb(var(--coral) / 0.1)", color: "rgb(var(--ink))" }}>{error}</p>
              )}

              <div className="flex w-full flex-col gap-2.5">
                {sessionStatus === "loading" ? null : !signedIn ? (
                  <>
                    <button type="button" onClick={() => signIn("twitter")} className="pop-btn min-h-[54px] w-full font-display text-[19px]">Sign in with X to accept</button>
                    <p className="text-[13px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>Rated games need an X sign-in so your rating and wallet stay yours.</p>
                  </>
                ) : own ? (
                  <p className="text-[15px] font-bold" style={{ color: "rgb(var(--ink-2))" }}>This is your own link. Send it to a friend; you will join when they open it.</p>
                ) : (
                  <button type="button" onClick={() => { void handleAccept(); }} disabled={accepting} className="pop-btn min-h-[54px] w-full font-display text-[19px]">
                    {accepting ? "Setting up the board…" : "Accept and play"}
                  </button>
                )}
                <Link href="/" className="min-h-[44px] content-center text-[14px] font-extrabold underline decoration-2 underline-offset-2" style={{ color: "rgb(var(--ink-2))" }}>
                  No thanks
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
