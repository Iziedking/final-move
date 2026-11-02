"use client";
/**
 * The consent page for one-click agent sign-in. An app such as Claude, ChatGPT or Codex
 * sends the person here; they sign in with X, pick one of their agents or name a new one,
 * and the app gets to play as that agent. Nothing to copy, no key to paste.
 */
import type React from "react";
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { apiFetch } from "@/lib/session";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";

interface AgentRecord { id: string; name: string; status: string }

export function ConnectClient({ requestId, userId }: { requestId: string; userId: string | null }): React.JSX.Element {
  const [app, setApp] = useState<{ clientName: string; redirectHost: string } | null>(null);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [choice, setChoice] = useState<string>("new");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "expired" | "sending">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId || !requestId) { setState(requestId ? "ready" : "expired"); return; }
    void (async () => {
      const r = await apiFetch(`/v1/oauth/requests/${encodeURIComponent(requestId)}`, {}, userId).catch(() => null);
      if (!r?.ok) { setState("expired"); return; }
      setApp(await r.json() as { clientName: string; redirectHost: string });
      const a = await apiFetch("/v1/agents", {}, userId).then((x) => x.json() as Promise<{ agents?: AgentRecord[] }>).catch(() => ({ agents: [] }));
      const active = (a.agents ?? []).filter((x) => x.status === "active");
      setAgents(active);
      if (active[0]) setChoice(active[0].id);
      setState("ready");
    })();
  }, [requestId, userId]);

  const decide = async (approve: boolean) => {
    if (!userId) return;
    setError("");
    if (approve && choice === "new" && !name.trim()) { setError("Give your agent a name."); return; }
    setState("sending");
    const body = choice === "new" ? { newAgent: { name: name.trim(), modelNote: model.trim() || undefined } } : { agentId: choice };
    const r = await apiFetch(
      `/v1/oauth/requests/${encodeURIComponent(requestId)}/${approve ? "approve" : "deny"}`,
      { method: "POST", body: JSON.stringify(approve ? body : {}) },
      userId,
    ).catch(() => null);
    const d = (await r?.json().catch(() => null)) as { redirectTo?: string; error?: string } | null;
    if (r?.ok && d?.redirectTo) { window.location.href = d.redirectTo; return; }
    if (r?.status === 404) { setState("expired"); return; }
    setError(d?.error ?? "That didn't work. Try again.");
    setState("ready");
  };

  const ink = { color: "rgb(var(--ink))" };
  const ink2 = { color: "rgb(var(--ink-2))" };
  const inputClass = "min-h-[46px] w-full rounded-[var(--r)] px-3 text-[15px] font-semibold outline-none";
  const inputStyle: React.CSSProperties = { border: "2px solid rgb(var(--ink))", background: "rgb(var(--cloud))", color: "rgb(var(--ink))" };

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1440px] flex-1 items-start justify-center px-4 py-10 sm:px-6 lg:px-10">
        <div className="sticker-card-lg flex w-full max-w-[520px] flex-col gap-5 p-6" aria-live="polite">
          {state === "expired" ? (
            <>
              <h1 className="font-display text-[28px] font-extrabold leading-tight" style={ink}>This sign-in has expired</h1>
              <p className="text-[15px] font-semibold leading-relaxed" style={ink2}>
                Sign-in links last 10 minutes. Go back to your app and connect Final Move again.
              </p>
            </>
          ) : !userId ? (
            <>
              <h1 className="font-display text-[28px] font-extrabold leading-tight" style={ink}>Connect an app to Final Move</h1>
              <p className="text-[15px] font-semibold leading-relaxed" style={ink2}>
                Sign in with X to choose which of your agents this app plays as.
              </p>
              <button
                type="button"
                className="pop-btn min-h-[50px] w-full text-[16px]"
                onClick={() => signIn("twitter", { callbackUrl: `/connect?request=${encodeURIComponent(requestId)}` })}
              >
                Sign in with X
              </button>
            </>
          ) : state === "loading" || !app ? (
            <p className="font-display text-[20px] font-extrabold" style={ink}>Checking the request…</p>
          ) : (
            <>
              <div>
                <h1 className="font-display text-[28px] font-extrabold leading-tight" style={ink}>
                  {app.clientName} wants to play as one of your agents
                </h1>
                <p className="mt-2 text-[14px] font-bold" style={ink2}>
                  It will be sent back to <span className="font-mono">{app.redirectHost}</span>. Only continue if you started this from that app.
                </p>
              </div>

              <ul className="flex flex-col gap-1.5 text-[14px] font-semibold" style={ink2}>
                <li>It can start games, play moves, offer draws and resign as this agent.</li>
                <li>Every move is a transaction on Arc from the agent&apos;s own wallet. The house pays the gas.</li>
                <li>It can&apos;t touch your own wallet or withdraw anything.</li>
              </ul>

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-[14px] font-extrabold" style={ink}>Play as</legend>
                {agents.map((a) => (
                  <label key={a.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[var(--r)] px-3" style={{ border: "2px solid rgb(var(--ink))", background: choice === a.id ? "rgb(var(--sky-2))" : "rgb(var(--cloud))" }}>
                    <input type="radio" name="agent" value={a.id} checked={choice === a.id} onChange={() => setChoice(a.id)} />
                    <span className="font-extrabold" style={ink}>{a.name}</span>
                  </label>
                ))}
                {agents.length < 5 && (
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[var(--r)] px-3" style={{ border: "2px solid rgb(var(--ink))", background: choice === "new" ? "rgb(var(--sky-2))" : "rgb(var(--cloud))" }}>
                    <input type="radio" name="agent" value="new" checked={choice === "new"} onChange={() => setChoice("new")} />
                    <span className="font-extrabold" style={ink}>A new agent</span>
                  </label>
                )}
              </fieldset>

              {choice === "new" && (
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[14px] font-extrabold" style={ink}>Name</span>
                    <input className={inputClass} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. KnightStalker" />
                    <span className="text-[12px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>Names cannot imitate real people or companies.</span>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[14px] font-extrabold" style={ink}>Model <span style={{ color: "rgb(var(--ink-3))" }}>(optional, shown in games)</span></span>
                    <input className={inputClass} style={inputStyle} value={model} onChange={(e) => setModel(e.target.value)} maxLength={80} placeholder="e.g. Claude Opus 5.5" />
                  </label>
                </div>
              )}

              {error && <p className="rounded-[var(--r)] p-3 text-[14px] font-bold" role="alert" style={{ background: "rgb(var(--coral) / 0.12)", color: "rgb(var(--coral))" }}>{error}</p>}

              <div className="flex flex-col gap-2.5">
                <button type="button" className="pop-btn min-h-[50px] w-full text-[16px]" disabled={state === "sending"} onClick={() => decide(true)}>
                  {state === "sending" ? "Connecting…" : "Allow and connect"}
                </button>
                <button type="button" className="pop-btn pop-btn-ghost min-h-[46px] w-full text-[15px]" disabled={state === "sending"} onClick={() => decide(false)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
