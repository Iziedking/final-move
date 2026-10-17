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

  useEffect(() => {
    fetch(`${API_BASE}/v1/challenges/${code}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("expired")))
      .then((d: Challenge) => setChallenge(d))
      .catch(() => setError("Challenge not found or expired."))
      .finally(() => setLoading(false));
  }, [code]);

  const handleAccept = async () => {
    if (!session?.user?.id) { setError("Sign in with X to accept this challenge."); return; }
    if (!challenge) return;
    setAccepting(true);
    try {
      const res = await fetch(`${API_BASE}/v1/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opponentId:   challenge.challengerId,
          timeControl:  challenge.timeControl,
          playerId:     session.user.id,
          playerHandle: session.user.handle ?? session.user.name ?? "Player",
          playerAvatar: session.user.image ?? undefined,
          gameClass:    challenge.gameClass,
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
      <div className="flex min-h-screen items-center justify-center" style={{ background: "rgb(var(--sky))" }}>
        <div className="font-display text-lg font-extrabold animate-pulse" style={{ color: "rgb(var(--ink-3))" }}>
          Loading challenge…
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "rgb(var(--sky))" }}>
      <div className="sticker-card w-full max-w-sm p-6 flex flex-col gap-4">
        <div className="font-display text-2xl font-extrabold text-center" style={{ color: "rgb(var(--ink))" }}>
          Challenge!
        </div>

        {error ? (
          <p className="text-center text-sm font-semibold" style={{ color: "rgb(var(--danger))" }}>{error}</p>
        ) : challenge ? (
          <>
            <p className="text-sm font-medium text-center" style={{ color: "rgb(var(--ink-2))" }}>
              You&apos;ve been challenged to a{" "}
              <strong>{challenge.timeControl}</strong>{" "}
              <strong className="capitalize">{challenge.gameClass}</strong> game.
            </p>

            <button
              onClick={() => { void handleAccept(); }}
              disabled={accepting}
              className="pop-btn w-full rounded-2xl py-3 font-display text-lg font-extrabold disabled:opacity-60"
            >
              {accepting ? "Accepting…" : "Accept challenge"}
            </button>

            <Link
              href="/"
              className="text-center text-sm font-semibold transition-colors"
              style={{ color: "rgb(var(--ink-3))" }}
            >
              Decline
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
