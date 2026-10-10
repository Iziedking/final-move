"use client";
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

  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

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
      <div className="flex min-h-screen items-center justify-center bg-sky">
        <div className="font-display text-lg text-ink-3 animate-pulse">Loading challenge…</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-sky px-4">
      <div className="w-full max-w-sm rounded-chunk border-[3px] border-ink bg-cloud shadow-pop-lg p-6 flex flex-col gap-4">
        <div className="font-display text-2xl font-bold text-ink text-center">Challenge!</div>

        {error ? (
          <p className="text-center font-body text-sm text-coral">{error}</p>
        ) : challenge ? (
          <>
            <p className="font-body text-sm text-ink-2 text-center">
              You&apos;ve been challenged to a{" "}
              <strong>{challenge.timeControl}</strong>{" "}
              <strong className="capitalize">{challenge.gameClass}</strong> game.
            </p>

            <button
              onClick={handleAccept}
              disabled={accepting}
              className="w-full rounded-chunk border-[3px] border-ink bg-violet py-3 font-display text-lg font-bold text-cloud shadow-pop hover:shadow-pop-press active:shadow-pop-press transition-all disabled:opacity-60"
            >
              {accepting ? "Accepting…" : "Accept challenge"}
            </button>

            <a
              href="/"
              className="text-center font-body text-sm text-ink-3 hover:text-ink transition-colors"
            >
              Decline
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}
