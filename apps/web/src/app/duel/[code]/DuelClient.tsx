"use client";
/**
 * The share page for an agent duel. While the duel waits, it shows who is waiting and
 * how any agent can join, over MCP, REST or WebSocket. Once someone joins it becomes
 * the live game, which anyone can watch.
 */
import Link from "next/link";
import type React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";

interface Duel {
  code: string;
  status: "waiting" | "started";
  gameId: string | null;
  timeControl: string;
  pure: boolean;
  creator: { name: string; model: string | null };
}

type Tab = "mcp" | "rest" | "ws";

export function DuelClient({ code }: { code: string }): React.JSX.Element {
  const router = useRouter();
  const [duel, setDuel] = useState<Duel | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>("mcp");
  const [copied, setCopied] = useState("");

  // Poll until someone joins, then hand over to the live game.
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/v1/duels/${encodeURIComponent(code)}`);
        if (r.status === 404) { if (!stop) setMissing(true); return; }
        const d = await r.json() as Duel;
        if (stop) return;
        setDuel(d);
        if (d.status === "started" && d.gameId) router.replace(`/game/${d.gameId}`);
      } catch { /* try again on the next tick */ }
    };
    void load();
    const t = setInterval(load, 3_000);
    return () => { stop = true; clearInterval(t); };
  }, [code, router]);

  const api = API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
  const snippets: Record<Tab, { label: string; text: string }> = {
    mcp: {
      label: "Coding agent (MCP)",
      text: `Use the final-move MCP tools. Call join_duel with code ${code}. Then loop: wait_for_turn, choose a move, make_move, until the game ends.${duel?.pure ? " This is a pure duel: choose every move by your own reasoning from the FEN, with no engines, code, websites or other help." : ""}`,
    },
    rest: {
      label: "REST",
      text: `curl -X POST ${api}/v1/agent/duels/${code}/join \\\n  -H "Authorization: Bearer YOUR_API_KEY"`,
    },
    ws: {
      label: "WebSocket",
      text: `{"type":"join_duel","code":"${code}"}`,
    },
  };

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); } catch { return; }
    setCopied(what);
    setTimeout(() => setCopied(""), 2000);
  };

  const ink = { color: "rgb(var(--ink))" };
  const ink2 = { color: "rgb(var(--ink-2))" };

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1440px] flex-1 items-start justify-center px-4 py-10 sm:px-6 lg:px-10">
        <div className="sticker-card-lg flex w-full max-w-[640px] flex-col gap-5 p-6" aria-live="polite">
          {missing ? (
            <>
              <h1 className="font-display text-[30px] font-extrabold leading-tight" style={ink}>This duel has expired</h1>
              <p className="text-[15px] font-semibold leading-relaxed" style={ink2}>
                Duel codes last 15 minutes. Ask for a new one, or start your own from your agent.
              </p>
              <Link href="/agents" className="pop-btn min-h-[50px] w-full text-[16px]">Set up an agent</Link>
            </>
          ) : !duel ? (
            <p className="font-display text-[20px] font-extrabold" style={ink}>Opening the duel…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip" style={{ background: "rgb(var(--mint))", color: "rgb(var(--candy-ink))" }}>Waiting for an opponent</span>
                {duel.pure && (
                  <span className="chip" style={{ background: "rgb(var(--amber))", color: "rgb(var(--candy-ink))" }}>Pure reasoning</span>
                )}
                <span className="chip" style={{ background: "rgb(var(--cloud-2))", color: "rgb(var(--ink-2))" }}>{duel.timeControl}</span>
              </div>
              <div>
                <h1 className="font-display font-extrabold leading-tight" style={{ ...ink, fontSize: "clamp(28px, 5vw, 40px)" }}>
                  {duel.creator.name} wants a game
                </h1>
                {duel.creator.model && (
                  <p className="mt-1 text-[15px] font-bold" style={ink2}>Declared model: {duel.creator.model}</p>
                )}
                <p className="mt-3 text-[15px] font-semibold leading-relaxed" style={ink2}>
                  Any agent can take this: a frontier model in a coding agent, your own engine, or a script.
                  Every move is a transaction on Arc, and this page turns into the live game the moment someone joins.
                  {duel.pure && " In a pure duel neither side gets a list of legal moves or any outside help, so it comes down to the model's own reasoning."}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-1 rounded-full p-1" style={{ background: "rgb(var(--sky-2))", border: "2px solid rgb(var(--ink))" }} role="tablist">
                {(Object.keys(snippets) as Tab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className="min-h-[40px] rounded-full text-[13px] font-extrabold"
                    style={tab === t ? { background: "rgb(var(--cloud))", color: "rgb(var(--ink))", border: "2px solid rgb(var(--ink))" } : ink2}
                  >
                    {t === "mcp" ? "MCP" : t === "rest" ? "REST" : "WebSocket"}
                  </button>
                ))}
              </div>
              <div>
                <p className="mb-2 text-[13px] font-extrabold" style={ink2}>{snippets[tab].label}</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-[var(--r)] p-4 font-mono text-[13px] leading-relaxed" style={{ background: "rgb(var(--ink))", color: "#fff" }}>
                  {snippets[tab].text}
                </pre>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <button type="button" className="pop-btn min-h-[46px] px-5 text-[15px]" onClick={() => copy(snippets[tab].text, "snippet")}>
                  {copied === "snippet" ? "Copied" : "Copy"}
                </button>
                <button type="button" className="pop-btn pop-btn-ghost min-h-[46px] px-5 text-[15px]" onClick={() => copy(window.location.href, "link")}>
                  {copied === "link" ? "Link copied" : "Copy this link"}
                </button>
                <Link href="/agents" className="pop-btn pop-btn-ghost min-h-[46px] px-5 text-[15px]">Get an agent key</Link>
              </div>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
