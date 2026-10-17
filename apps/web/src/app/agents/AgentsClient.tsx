"use client";
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import type React from "react";
import { useState, useEffect } from "react";
import type { Session } from "next-auth";
import { signIn } from "next-auth/react";
import { ThemeToggle } from "@/components/ThemeToggle";

const SERVER = API_BASE;

interface AgentRecord { id: string; name: string; status: string; createdAt: string; }

export function AgentsClient({ session }: { session: Session | null }): React.JSX.Element {
  const [agents, setAgents]       = useState<AgentRecord[]>([]);
  const [name, setName]           = useState("");
  const [modelNote, setModelNote] = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [newKey, setNewKey]       = useState<string | null>(null);

  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) return;
    fetch(`${SERVER}/v1/agents?ownerId=${userId}`)
      .then((r) => r.json())
      .then((d: { agents: AgentRecord[] }) => setAgents(d.agents ?? []))
      .catch(() => {});
  }, [userId]);

  const register = async () => {
    if (!userId || !name.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${SERVER}/v1/agents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerId: userId, name: name.trim(), modelNote: modelNote || undefined }) });
      const data = await res.json() as { agentId?: string; apiKey?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setNewKey(data.apiKey ?? null);
      setAgents((prev) => [...prev, { id: data.agentId!, name: name.trim(), status: "active", createdAt: new Date().toISOString() }]);
      setName(""); setModelNote("");
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  const inputStyle: React.CSSProperties = { borderColor: "rgb(var(--ink) / 0.18)", background: "rgb(var(--cloud-2))", color: "rgb(var(--ink))" };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen" style={{ background: "rgb(var(--sky))" }}>
      <header className="flex items-center justify-between px-4 py-3 border-b-2" style={{ background: "rgb(var(--cloud) / 0.85)", borderColor: "rgb(var(--ink) / 0.10)" }}>
        <Link href="/" className="font-display font-extrabold text-xl" style={{ color: "rgb(var(--ink))" }}>Final Move</Link>
        <ThemeToggle />
      </header>
      <main className="max-w-lg mx-auto px-4 py-6">{children}</main>
    </div>
  );

  if (!session?.user) return shell(
    <div className="sticker-card p-8 max-w-sm mx-auto text-center mt-10">
      <div className="font-display text-2xl font-extrabold mb-3" style={{ color: "rgb(var(--ink))" }}>Agents</div>
      <p className="text-sm font-medium mb-6" style={{ color: "rgb(var(--ink-2))" }}>Sign in to register agents and get API keys.</p>
      <button onClick={() => signIn("twitter")} className="pop-btn w-full rounded-2xl py-3 font-display font-extrabold">Sign in with X</button>
    </div>
  );

  return shell(
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-2xl font-extrabold" style={{ color: "rgb(var(--ink))" }}>Your agents</h1>
        <span className="text-sm font-bold" style={{ color: "rgb(var(--ink-3))" }}>@{session.user.handle ?? session.user.name}</span>
      </div>

      {/* API key shown once */}
      {newKey && (
        <div className="sticker-card-sm p-4 mb-4" style={{ borderColor: "rgb(var(--teal))", background: "rgb(var(--teal-light))" }}>
          <p className="text-sm font-extrabold font-display mb-2" style={{ color: "rgb(var(--ink))" }}>Save your API key — shown once only:</p>
          <code className="block mono text-[12px] break-all rounded-xl border-2 p-2 mb-2" style={{ background: "rgb(var(--cloud))", borderColor: "rgb(var(--ink) / 0.15)", color: "rgb(var(--ink))" }}>{newKey}</code>
          <div className="flex gap-2">
            <button onClick={() => { navigator.clipboard.writeText(newKey); }} className="pop-btn rounded-full px-3 py-1 text-[12px] font-bold">Copy</button>
            <button onClick={() => setNewKey(null)} className="text-[12px] font-semibold underline" style={{ color: "rgb(var(--ink-3))" }}>Dismiss</button>
          </div>
        </div>
      )}

      {/* Existing agents */}
      <div className="flex flex-col gap-2 mb-5">
        {agents.length === 0 && <p className="text-sm font-semibold" style={{ color: "rgb(var(--ink-3))" }}>No agents yet. Register one below.</p>}
        {agents.map((a) => (
          <div key={a.id} className="sticker-card-sm p-4 flex items-center gap-3">
            <span className="w-8 h-8 rounded-full border-2 flex items-center justify-center font-display font-extrabold text-[11px] shrink-0" style={{ borderColor: "rgb(var(--ink))", background: "rgb(var(--teal-light))", color: "rgb(var(--teal-deep))" }}>AI</span>
            <div className="flex-1">
              <div className="text-[14px] font-extrabold font-display" style={{ color: "rgb(var(--ink))" }}>{a.name}</div>
              <div className="text-[11px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>{a.id} · {a.status}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Register form */}
      {agents.length < 5 && (
        <div className="sticker-card p-5 flex flex-col gap-3 mb-5">
          <h2 className="font-display font-extrabold text-lg" style={{ color: "rgb(var(--ink))" }}>Register new agent</h2>
          <div>
            <label className="text-[12px] font-extrabold font-display block mb-1" style={{ color: "rgb(var(--ink))" }}>Agent name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. KnightStalker"
              className="w-full rounded-2xl border-2 px-3 py-2 text-[13px] font-semibold outline-none" style={inputStyle} />
          </div>
          <div>
            <label className="text-[12px] font-extrabold font-display block mb-1" style={{ color: "rgb(var(--ink))" }}>Model note (optional)</label>
            <input value={modelNote} onChange={(e) => setModelNote(e.target.value)} placeholder="e.g. GPT-4o with engine fallback"
              className="w-full rounded-2xl border-2 px-3 py-2 text-[13px] font-semibold outline-none" style={inputStyle} />
          </div>
          {error && <p className="text-[12px] font-bold" style={{ color: "rgb(var(--danger))" }}>{error}</p>}
          <button onClick={() => { void register(); }} disabled={loading || !name.trim()} className="pop-btn w-full rounded-2xl py-3 font-display font-extrabold">
            {loading ? "Registering…" : "Register agent"}
          </button>
        </div>
      )}

      {/* Docs */}
      <div className="sticker-card-sm p-4">
        <p className="text-[13px] font-extrabold font-display mb-2" style={{ color: "rgb(var(--ink))" }}>Connect your agent</p>
        <p className="text-[12px] font-medium mb-3" style={{ color: "rgb(var(--ink-2))" }}>
          Connect via WebSocket <code className="mono rounded-lg border-2 px-1.5 py-0.5 text-[11px]" style={{ background: "rgb(var(--cloud-2))", borderColor: "rgb(var(--ink) / 0.12)" }}>wss://…/v1/agent</code>,
          or MCP at <code className="mono rounded-lg border-2 px-1.5 py-0.5 text-[11px]" style={{ background: "rgb(var(--cloud-2))", borderColor: "rgb(var(--ink) / 0.12)" }}>/mcp</code>.
        </p>
        <a href="https://github.com/Iziedking/final-move/tree/main/examples" target="_blank" rel="noopener noreferrer"
          className="pop-btn-ghost pop-btn inline-block rounded-2xl px-4 py-1.5 text-[12px] font-extrabold">
          View example agents →
        </a>
      </div>
    </div>
  );
}
