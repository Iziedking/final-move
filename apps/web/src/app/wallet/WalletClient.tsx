"use client";
/**
 * The player's own Arc wallet: balance, address and, on testnet, stake history. The wallet
 * is created for every signed-in player and signs each of their moves, so
 * there are never signing popups. Gas is topped up by the house.
 */
import { apiFetch, describeError } from "@/lib/session";
import Link from "next/link";
import type React from "react";
import { useEffect, useState } from "react";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";
import { ARC_EXPLORER, IS_MAINNET, STAKES_ENABLED } from "@/lib/network";

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

const EXPLORER = ARC_EXPLORER;

function Coin({ size = 44 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden>
      <circle cx="24" cy="25.5" r="19" fill="#171449" />
      <circle cx="24" cy="23" r="19" fill="#FFB13C" stroke="#171449" strokeWidth="3" />
      <circle cx="24" cy="23" r="12.5" fill="none" stroke="#171449" strokeWidth="2" opacity="0.35" />
      <path d="M27.5 17.5c-1-1-2.2-1.5-3.6-1.5-2.4 0-4 1.3-4 3.2 0 4.4 7.9 2.4 7.9 6.8 0 2-1.8 3.4-4.2 3.4-1.6 0-3-.6-4-1.7M24 13.5v2.5M24 29.5V32" fill="none" stroke="#171449" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

const DEPOSIT_STATE: Record<string, { label: string; bg: string; fg: string }> = {
  confirmed: { label: "Confirmed", bg: "var(--mint)",  fg: "var(--candy-ink)" },
  failed:    { label: "Failed",    bg: "var(--coral)", fg: "255 255 255" },
};

export default function WalletClient({ userId }: { userId: string }): React.JSX.Element {
  const [data, setData]       = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    apiFetch(`/v1/wallet/${userId}`, {}, userId)
      .then((r) => r.json() as Promise<WalletData | { error: string }>)
      .then((j) => { if ("error" in j) setErr(describeError(j.error)); else setData(j); })
      .catch(() => setErr("We could not load your wallet. Try again in a moment."))
      .finally(() => setLoading(false));
  }, [userId]);

  const copy = async () => {
    if (!data?.walletAddress) return;
    try { await navigator.clipboard.writeText(data.walletAddress); } catch { return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 pt-8 sm:px-6 lg:px-10">
        <div>
          <h1 className="font-display font-extrabold" style={{ fontSize: "clamp(36px, 5vw, 60px)", lineHeight: 1.02, color: "rgb(var(--ink))" }}>Your wallet</h1>
          <p className="mt-2 max-w-[620px] text-[17px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
            This Arc wallet was made for you when you signed in. It signs every move you play, so you never see a wallet popup.
          </p>
        </div>
        {children}
      </main>
      <SiteFooter />
    </div>
  );

  if (loading) return shell(
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2" aria-label="Loading your wallet">
      <div className="sticker-card h-[180px] animate-pulse" style={{ background: "rgb(var(--cloud-2))" }} />
      <div className="sticker-card h-[180px] animate-pulse" style={{ background: "rgb(var(--cloud-2))" }} />
    </div>
  );

  if (err || !data) return shell(
    <div className="sticker-card flex flex-col items-start gap-3 p-6" role="alert">
      <p className="font-display text-[22px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>{err || "We could not find your wallet."}</p>
      <p className="text-[15px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>
        Wallets are set up a few seconds after your first sign-in. Reload this page, or play a game and come back.
      </p>
      <Link href="/" className="pop-btn px-5 text-[15px]">Play a game</Link>
    </div>
  );

  return shell(
    <>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Balance */}
        <section className="sticker-card-lg flex flex-col gap-3 p-6" aria-labelledby="bal">
          <p id="bal" className="text-[14px] font-extrabold" style={{ color: "rgb(var(--ink-2))" }}>Balance</p>
          <div className="flex items-center gap-3">
            <Coin />
            <span className="font-display font-extrabold leading-none tabular-nums" style={{ fontSize: "clamp(44px, 7vw, 64px)", color: "rgb(var(--ink))" }}>
              {data.balanceDisplay}
            </span>
            <span className="self-end pb-2 text-[16px] font-extrabold" style={{ color: "rgb(var(--ink-2))" }}>{data.isTestnet ? "test USDC" : "USDC"}</span>
          </div>
          {data.isTestnet && (
            <p className="text-[14px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>Testnet USDC has no real value.</p>
          )}
        </section>

        {/* Address */}
        <section className="sticker-card flex flex-col gap-3 p-6" aria-labelledby="addr">
          <p id="addr" className="text-[14px] font-extrabold" style={{ color: "rgb(var(--ink-2))" }}>Your Arc address</p>
          <p className="break-all rounded-xl p-3 font-mono text-[13px] font-medium" style={{ background: "rgb(var(--cloud-2))", color: "rgb(var(--ink))", border: "2px solid rgb(var(--ink) / 0.15)" }}>
            {data.walletAddress}
          </p>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <button type="button" onClick={() => { void copy(); }} className="pop-btn flex-1 px-4 text-[15px]" aria-live="polite">
              {copied ? "Copied" : "Copy address"}
            </button>
            <a href={`${EXPLORER}/address/${data.walletAddress}`} target="_blank" rel="noopener noreferrer" className="pop-btn pop-btn-ghost flex-1 px-4 text-[15px]">
              View on explorer ↗
            </a>
          </div>
        </section>
      </div>

      <div className={`grid grid-cols-1 gap-6 ${STAKES_ENABLED ? "md:grid-cols-2" : ""}`}>
        {/* Gas and funding */}
        <section className="sticker-card flex flex-col gap-3 p-6" aria-labelledby="gas">
          <h2 id="gas" className="font-display text-[22px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Who pays for moves</h2>
          <p className="text-[15px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
            Each move is a small Arc transaction, and Arc charges gas in USDC. The house tops up your wallet with enough gas to play, so you never need to fund it to play rated games.
          </p>
          {IS_MAINNET ? (
            <p className="text-[15px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
              This is Arc mainnet, so gas is paid in real USDC. You only need it for gas, and the house covers that. There are no stakes or entry fees on mainnet.
            </p>
          ) : data.isTestnet && (
            <>
              <p className="text-[15px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
                Want test USDC for staked games? Copy your address, open the Circle faucet, choose Arc testnet and paste it.
              </p>
              <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className="pop-btn pop-btn-amber self-start px-5 text-[15px]">
                Open the Circle faucet ↗
              </a>
            </>
          )}
        </section>

        {/* Stake history (testnet only: mainnet has no stakes) */}
        {STAKES_ENABLED && <section className="sticker-card flex flex-col gap-3 p-6" aria-labelledby="stakes">
          <h2 id="stakes" className="font-display text-[22px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Stake history</h2>
          {data.deposits.length === 0 ? (
            <p className="text-[15px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>No staked games yet. Deposits you make for staked games show up here.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.deposits.map((d) => {
                const st = DEPOSIT_STATE[d.state] ?? { label: d.state.charAt(0).toUpperCase() + d.state.slice(1), bg: "var(--cloud)", fg: "var(--ink-2)" };
                return (
                  <li key={`${d.stakeOfferId}-${d.createdAt}`} className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl px-3 py-2" style={{ background: "rgb(var(--cloud-2))" }}>
                    <span className="flex items-center gap-2">
                      <span className="chip py-0 text-[11px]" style={{ background: `rgb(${st.bg})`, color: `rgb(${st.fg})` }}>{st.label}</span>
                      <span className="text-[13px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>{new Date(d.createdAt).toLocaleDateString()}</span>
                    </span>
                    {d.explorerUrl && d.txHash ? (
                      <a href={d.explorerUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-[12px] font-medium underline" style={{ color: "rgb(var(--violet))" }}>
                        {d.txHash.slice(0, 10)}…
                      </a>
                    ) : <span className="text-[12px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>No transaction yet</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>}
      </div>
    </>
  );
}
