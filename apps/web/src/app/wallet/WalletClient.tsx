"use client";
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import type React from "react";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

const API = API_BASE;

interface Deposit {
  stakeOfferId: string;
  state:        string;
  txHash:       string | null;
  explorerUrl:  string | null;
  createdAt:    string;
}
interface WalletData {
  walletAddress:  string;
  balanceUsdc6:   number;
  balanceDisplay: string;
  isTestnet:      boolean;
  deposits:       Deposit[];
}

export default function WalletClient({ userId }: { userId: string }): React.JSX.Element {
  const [data, setData]     = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`${API}/v1/wallet/${userId}`)
      .then((r) => r.json() as Promise<WalletData | { error: string }>)
      .then((j) => { if ("error" in j) setErr(j.error); else setData(j); })
      .catch(() => setErr("failed to load wallet"))
      .finally(() => setLoading(false));
  }, [userId]);

  const copy = async () => {
    if (!data?.walletAddress) return;
    await navigator.clipboard.writeText(data.walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen" style={{ background: "rgb(var(--sky))" }}>
      <header
        className="flex items-center justify-between px-4 py-3 border-b-2"
        style={{ background: "rgb(var(--cloud) / 0.85)", borderColor: "rgb(var(--ink) / 0.10)" }}
      >
        <Link href="/" className="font-display font-extrabold text-xl" style={{ color: "rgb(var(--ink))" }}>Final Move</Link>
        <ThemeToggle />
      </header>
      <main className="max-w-md mx-auto px-4 py-8">{children}</main>
    </div>
  );

  if (loading) return shell(
    <div className="flex items-center justify-center py-20">
      <p className="font-display font-bold animate-pulse" style={{ color: "rgb(var(--ink-2))" }}>Loading wallet…</p>
    </div>
  );

  if (err || !data) return shell(
    <div className="sticker-card p-6 text-center">
      <p className="font-bold" style={{ color: "rgb(var(--coral))" }}>{err || "Wallet not found"}</p>
      <p className="text-sm font-semibold mt-2" style={{ color: "rgb(var(--ink-3))" }}>Sign in to create your wallet.</p>
    </div>
  );

  return shell(
    <div className="flex flex-col gap-4">
      {/* Balance card */}
      <div className="sticker-card p-6">
        <p className="text-[11px] font-extrabold uppercase tracking-widest font-display mb-1" style={{ color: "rgb(var(--ink-3))" }}>Balance</p>
        <div className="flex items-end gap-2">
          <span className="font-display text-4xl font-extrabold" style={{ color: "rgb(var(--ink))" }}>{data.balanceDisplay}</span>
          <span className="text-sm font-bold mb-1" style={{ color: "rgb(var(--ink-2))" }}>{data.isTestnet ? "test USDC" : "USDC"}</span>
        </div>
        {data.isTestnet && (
          <p className="text-xs font-semibold mt-1" style={{ color: "rgb(var(--ink-3))" }}>Testnet only — no real value</p>
        )}
      </div>

      {/* Address card */}
      <div className="sticker-card p-5 flex flex-col gap-3">
        <p className="text-[11px] font-extrabold uppercase tracking-widest font-display" style={{ color: "rgb(var(--ink-3))" }}>Your Arc address</p>
        <p className="mono text-xs break-all font-semibold" style={{ color: "rgb(var(--ink))" }}>{data.walletAddress}</p>
        <button onClick={() => { void copy(); }} className="pop-btn w-full rounded-2xl py-2.5 text-sm font-extrabold">
          {copied ? "Copied! ✓" : "Copy address"}
        </button>
      </div>

      {/* Faucet */}
      {data.isTestnet && (
        <div className="sticker-card p-5 flex flex-col gap-3">
          <p className="text-[11px] font-extrabold uppercase tracking-widest font-display" style={{ color: "rgb(var(--ink-3))" }}>Get test USDC</p>
          <p className="text-sm font-medium" style={{ color: "rgb(var(--ink-2))" }}>
            Use the Arc Studio sidebar "Get test USDC" button to fund this wallet.
          </p>
          <a
            href={`https://faucet.circle.com/?chain=ARC-TESTNET&address=${data.walletAddress}`}
            target="_blank" rel="noopener noreferrer"
            className="pop-btn-ghost pop-btn w-full rounded-2xl py-2.5 text-sm font-extrabold text-center block"
          >
            Open faucet →
          </Link>
        </div>
      )}

      {/* Stake history */}
      {data.deposits.length > 0 && (
        <div className="sticker-card p-5 flex flex-col gap-3">
          <p className="text-[11px] font-extrabold uppercase tracking-widest font-display" style={{ color: "rgb(var(--ink-3))" }}>Stake history</p>
          <ul className="flex flex-col gap-2">
            {data.deposits.map((d) => (
              <li key={d.stakeOfferId} className="flex items-center justify-between text-sm">
                <span className="font-bold" style={{ color: d.state === "confirmed" ? "rgb(var(--teal))" : d.state === "failed" ? "rgb(var(--coral))" : "rgb(var(--ink-2))" }}>
                  {d.state}
                </span>
                {d.explorerUrl && (
                  <a href={d.explorerUrl} target="_blank" rel="noopener noreferrer"
                    className="mono text-xs underline" style={{ color: "rgb(var(--teal))" }}>
                    {d.txHash?.slice(0, 10)}…
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
