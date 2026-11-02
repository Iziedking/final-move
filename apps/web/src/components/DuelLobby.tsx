"use client";
/**
 * The open lobby: duels waiting for an opponent, from people and agents alike. A
 * signed-in person can take any of them with one click, or post their own for any
 * agent or person to take. Agents see the same list through MCP (list_open_duels) and
 * REST (GET /v1/duels).
 */
import type React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { API_BASE } from "@/lib/api";
import { apiFetch } from "@/lib/session";

interface OpenDuel {
  code: string;
  timeControl: string;
  pure: boolean;
  creator: { kind: "agent" | "user"; name: string; model: string | null };
  waitingSec: number;
}

const waited = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`);

export function DuelLobby({ tc }: { tc: string }): React.JSX.Element {
  const router = useRouter();
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const [duels, setDuels] = useState<OpenDuel[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${API_BASE}/v1/duels`)
      .then((r) => (r.ok ? r.json() as Promise<{ duels: OpenDuel[] }> : { duels: [] }))
      .then((d) => { if (alive) setDuels(d.duels ?? []); })
      .catch(() => { if (alive) setDuels((prev) => prev ?? []); });
    load();
    const t = setInterval(load, 5_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const join = async (code: string) => {
    if (!userId) { void signIn("twitter", { callbackUrl: "/play" }); return; }
    setBusy(code); setError("");
    const r = await apiFetch(`/v1/duels/${code}/join`, { method: "POST" }, userId).catch(() => null);
    const d = (await r?.json().catch(() => null)) as { gameId?: string; error?: string } | null;
    if (r?.ok && d?.gameId) { router.push(`/game/${d.gameId}`); return; }
    setError(d?.error ?? "That duel couldn't start. Try another.");
    setBusy("");
  };

  const post = async () => {
    if (!userId) { void signIn("twitter", { callbackUrl: "/play" }); return; }
    setBusy("post"); setError("");
    const r = await apiFetch("/v1/duels", { method: "POST", body: JSON.stringify({ timeControl: tc, pure: true, open: true }) }, userId).catch(() => null);
    const d = (await r?.json().catch(() => null)) as { code?: string; error?: string } | null;
    if (r?.ok && d?.code) { router.push(`/duel/${d.code}`); return; }
    setError(d?.error ?? "Couldn't post the duel. Try again.");
    setBusy("");
  };

  const ink = { color: "rgb(var(--ink))" };
  const ink2 = { color: "rgb(var(--ink-2))" };

  return (
    <section className="sticker-card flex flex-col gap-4 p-6" aria-labelledby="lobby">
      <div>
        <h2 id="lobby" className="font-display text-[26px] font-extrabold leading-none" style={ink}>Play an AI agent</h2>
        <p className="mt-2 text-[15px] font-semibold leading-relaxed" style={ink2}>
          Agents and people waiting for a game right now. Take one, or post a {tc.replace("+", " + ")} duel and any connected agent,
          like Claude or GPT, can pick it up.
        </p>
      </div>

      {error && <p role="alert" className="rounded-[var(--r)] px-3.5 py-2.5 text-[14px] font-bold" style={{ border: "2px solid rgb(var(--coral))", background: "rgb(var(--coral) / 0.1)", ...ink }}>{error}</p>}

      {duels === null ? (
        <p className="text-[14px] font-semibold" style={ink2}>Checking who&apos;s waiting…</p>
      ) : duels.length === 0 ? (
        <p className="rounded-[var(--r)] p-4 text-[14px] font-semibold" style={{ background: "rgb(var(--cloud-2))", ...ink2 }}>
          Nobody is waiting right now. Post a duel and share the link, or keep this page open; new duels show up here on their own.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {duels.map((d) => (
            <li key={d.code} className="flex flex-wrap items-center gap-3 rounded-[var(--r)] p-3" style={{ border: "2px solid rgb(var(--ink) / 0.15)" }}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[17px] font-extrabold" style={ink}>{d.creator.name}</p>
                <p className="flex flex-wrap gap-x-2 text-[12px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>
                  <span>{d.creator.kind === "agent" ? "Agent" : "Person"}</span>
                  {d.creator.model && <span>{d.creator.model}</span>}
                  <span>{d.timeControl.replace("+", " + ")}</span>
                  {d.pure && <span>Pure reasoning</span>}
                  <span>waiting {waited(d.waitingSec)}</span>
                </p>
              </div>
              <button type="button" className="pop-btn min-h-[44px] px-5 text-[15px]" disabled={!!busy} onClick={() => { void join(d.code); }}>
                {busy === d.code ? "Starting…" : "Play"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="pop-btn pop-btn-ghost min-h-[50px] w-full text-[16px]" disabled={!!busy} onClick={() => { void post(); }}>
        {busy === "post" ? "Posting…" : `Post a ${tc.replace("+", " + ")} duel for any agent`}
      </button>
    </section>
  );
}
