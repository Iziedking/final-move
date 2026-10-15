"use client";
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import type React from "react";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface Challenge {
  challengerId: string;
  gameClass:    string;
  timeControl:  string;
}

export function ChallengeAcceptClient({ code }: { code: string }): React.JSX.Element {
  const { data: session } = useSession();
  const router = useRouter();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading]     = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const serverUrl = API_BASE;

  useEffect(() => {
    fetch(`${serverUrl}/v1/challenges/${code}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("expired")))
      .then((d: Challenge) => setChallenge(d))
      .catch(() => setError("Challenge not found or expired."))
      .finally(() => setLoading(false));
  }, [code, serverUrl]);

  const handleAccept = async () => {
    if (!session?.user?.id) {
      setError("Sign in with X to accept this challenge.");
      return;
    }
    if (!challenge) return;
    setAccepting(true);
    try {
      // Look up both players' wallets and create a human vs human game
      const res = await fetch(`${serverUrl}/v1/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opponentId:    challenge.challengerId,
          timeControl:   challenge.timeControl,
          playerId:      session.user.id,
          playerHandle:  session.user.handle ?? session.user.name ?? "Player",
          playerAvatar:  session.user.image ?? undefined,
          gameClass:     challenge.gameClass,
        }),
      });
      if (!res.ok) throw new Error("Failed to create game");
      const data = await res.json() as { gameId: string; color: "w" | "b" };
      router.push(`/game/${data.gameId}?pid=${session.user.id}&color=${data.color}`);
    } catch (e) {
      setError((e as Error).message);
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-fm-canvas">
        <div className="font-display text-lg text-fm-ink3 animate-pulse">Loading challenge…</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-fm-canvas px-4">
      <div className="w-full max-w-sm rounded-xl border border-fm-ink/20 bg-fm-surface  p-6 flex flex-col gap-4">
        <div className="font-display text-2xl font-bold text-fm-ink text-center">Challenge!</div>

        {error ? (
          <p className="text-center text-sm text-sm text-fm-danger">{error}</p>
        ) : challenge ? (
          <>
            <p className="text-sm text-sm text-fm-ink2 text-center">
              You&apos;ve been challenged to a{" "}
              <strong>{challenge.timeControl}</strong>{" "}
              <strong className="capitalize">{challenge.gameClass}</strong> game.
            </p>

            <button
              onClick={handleAccept}
              disabled={accepting}
              className="w-full rounded-xl border border-fm-ink/20 bg-fm-green py-3 font-display text-lg font-bold text-white  hover: active: transition-all disabled:opacity-60"
            >
              {accepting ? "Accepting…" : "Accept challenge"}
            </button>

            <a
              href="/"
              className="text-center text-sm text-sm text-fm-ink3 hover:text-fm-ink transition-colors"
            >
              Decline
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
