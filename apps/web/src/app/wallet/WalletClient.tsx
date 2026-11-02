"use client";
/**
 * The player's Arc wallet: balance, address, withdraw, deposit and stake history.
 */
import { apiFetch, describeError } from "@/lib/session";
import Link from "next/link";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";
import { ARC_EXPLORER, IS_MAINNET, STAKES_ENABLED } from "@/lib/network";

// ── Types ────────────────────────────────────────────────────────────────────

interface Deposit {
  stakeOfferId: string;
  state:        string;
  txHash:       string | null;
  explorerUrl:  string | null;
  createdAt:    string;
}

interface Withdrawal {
  id:           string;
  destination:  string;
  amountDisplay: string;
  state:        "pending" | "sent" | "complete" | "failed";
  txHash:       string | null;
  explorerUrl:  string | null;
  error:        string | null;
  createdAt:    string;
}

interface WalletData {
  walletAddress:      string;
  balanceUsdc6:       number;
  balanceDisplay:     string;
  withdrawableUsdc6:  string;
  gasReserveUsdc6:    string;
  isTestnet:          boolean;
  deposits:           Deposit[];
  withdrawals:        Withdrawal[];
}

const EXPLORER = ARC_EXPLORER;

// ── Small shared components ───────────────────────────────────────────────────

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

const WITHDRAWAL_STATE: Record<string, { label: string; bg: string; fg: string }> = {
  pending:  { label: "Pending",  bg: "var(--cloud)",   fg: "var(--ink-2)" },
  sent:     { label: "Sent",     bg: "var(--amber)",   fg: "var(--candy-ink)" },
  complete: { label: "Complete", bg: "var(--mint)",    fg: "var(--candy-ink)" },
  failed:   { label: "Failed",   bg: "var(--coral)",   fg: "255 255 255" },
};

// ── Main component ────────────────────────────────────────────────────────────

export default function WalletClient({ userId }: { userId: string }): React.JSX.Element {
  const [data, setData]       = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");
  const [copied, setCopied]   = useState(false);

  const loadData = () => {
    setLoading(true);
    apiFetch(`/v1/wallet/${userId}`, {}, userId)
      .then((r) => r.json() as Promise<WalletData | { error: string }>)
      .then((j) => { if ("error" in j) setErr(describeError(j.error)); else setData(j); })
      .catch(() => setErr("We could not load your wallet. Try again in a moment."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, [userId]); // loadData is stable for this userId

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

  const withdrawableUsdc6 = BigInt(data.withdrawableUsdc6 ?? "0");
  const gasReserveDisplay = (Number(data.gasReserveUsdc6 ?? "250000") / 1_000_000).toFixed(2);
  const withdrawableDisplay = (Number(withdrawableUsdc6) / 1_000_000).toFixed(2);

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
          <p className="text-[13px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
            Available to withdraw: <span className="font-extrabold" style={{ color: "rgb(var(--ink-2))" }}>{withdrawableDisplay} USDC</span>
          </p>
          <p className="text-[12px]" style={{ color: "rgb(var(--ink-3))" }}>
            We keep {gasReserveDisplay} USDC in your wallet to cover gas.
          </p>
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

      {/* Deposit card */}
      <section className="sticker-card flex flex-col gap-3 p-6" aria-labelledby="deposit-head">
        <h2 id="deposit-head" className="font-display text-[22px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Deposit</h2>
        <p className="text-[15px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
          Send USDC on Arc to your address above. Only send from the Arc network, or your funds may be lost. You don&apos;t need to deposit to play.
        </p>
        <button type="button" onClick={() => { void copy(); }} className="pop-btn self-start px-5 text-[15px]" aria-live="polite">
          {copied ? "Copied" : "Copy your address"}
        </button>
      </section>

      {/* Withdraw card */}
      <WithdrawCard
        userId={userId}
        withdrawableUsdc6={withdrawableUsdc6}
        isTestnet={data.isTestnet}
        onSuccess={loadData}
      />

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

        {/* Stake history (testnet only) */}
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

      {/* Withdrawal history */}
      {data.withdrawals.length > 0 && (
        <section className="sticker-card flex flex-col gap-3 p-6" aria-labelledby="wh-head">
          <h2 id="wh-head" className="font-display text-[22px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Withdrawal history</h2>
          <ul className="flex flex-col gap-2">
            {data.withdrawals.map((w) => {
              const st = WITHDRAWAL_STATE[w.state] ?? { label: w.state, bg: "var(--cloud)", fg: "var(--ink-2)" };
              return (
                <li key={w.id} className="flex flex-col gap-1 rounded-xl px-3 py-2.5" style={{ background: "rgb(var(--cloud-2))" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="chip py-0 text-[11px]" style={{ background: `rgb(${st.bg})`, color: `rgb(${st.fg})` }}>{st.label}</span>
                      <span className="font-display text-[15px] font-extrabold tabular-nums" style={{ color: "rgb(var(--ink))" }}>{w.amountDisplay} USDC</span>
                    </div>
                    <span className="text-[12px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>
                      {new Date(w.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="break-all font-mono text-[11px]" style={{ color: "rgb(var(--ink-3))" }}>
                    To: {w.destination}
                  </p>
                  {w.explorerUrl && w.txHash && (
                    <a href={w.explorerUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] underline" style={{ color: "rgb(var(--violet))" }}>
                      {w.txHash.slice(0, 18)}…
                    </a>
                  )}
                  {w.error && <p className="text-[12px]" style={{ color: "rgb(var(--coral))" }}>{w.error}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

// ── Withdraw card ─────────────────────────────────────────────────────────────

type WithdrawStep = "form" | "confirm" | "done";

interface WithdrawCardProps {
  userId:            string;
  withdrawableUsdc6: bigint;
  isTestnet:         boolean;
  onSuccess:         () => void;
}

function WithdrawCard({ userId, withdrawableUsdc6, isTestnet, onSuccess }: WithdrawCardProps): React.JSX.Element {
  const [step, setStep]         = useState<WithdrawStep>("form");
  const [dest, setDest]         = useState("");
  const [amount, setAmount]     = useState("");
  const [formErr, setFormErr]   = useState("");
  const [busy, setBusy]         = useState(false);
  const [serverErr, setServerErr] = useState("");
  const [result, setResult]     = useState<{ state: string; txHash?: string | null; explorerUrl?: string } | null>(null);

  // Generate one idempotency key per form session; reuse on retry.
  const idempKey = useRef<string>("");
  if (!idempKey.current) idempKey.current = crypto.randomUUID();

  // Round DOWN so the Max value never exceeds what the server will accept.
  const withdrawableFloor = Number(withdrawableUsdc6) / 1_000_000;
  const withdrawableDisplay = Math.floor(withdrawableFloor * 100) / 100;
  const amountUsdc6 = BigInt(Math.round(parseFloat(amount || "0") * 1_000_000));

  const setMax = () => setAmount(withdrawableDisplay.toFixed(6));

  const validate = (): boolean => {
    if (!dest.trim()) { setFormErr("Enter a destination address."); return false; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(dest.trim())) { setFormErr("Destination is not a valid address."); return false; }
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) { setFormErr("Enter an amount."); return false; }
    if (amountUsdc6 > withdrawableUsdc6) { setFormErr(`Maximum is ${withdrawableDisplay.toFixed(2)} USDC.`); return false; }
    setFormErr("");
    return true;
  };

  const goConfirm = () => { if (validate()) setStep("confirm"); };

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const submit = async () => {
    setBusy(true);
    setServerErr("");
    try {
      const res = await apiFetch("/v1/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination: dest.trim(), amountUsdc: parseFloat(amount), idempotencyKey: idempKey.current }),
      }, userId);
      const json = await res.json() as { state?: string; txHash?: string; error?: string };
      if (json.error) {
        setServerErr(json.error);
        setStep("form");
        // Generate a new idempotency key only after a definite failure (not 502/uncertain).
        if (res.status !== 502) idempKey.current = crypto.randomUUID();
      } else {
        const initialState = json.state ?? "sent";
        setResult({
          state:       initialState,
          txHash:      json.txHash ?? null,
          explorerUrl: json.txHash ? `${EXPLORER}/tx/${json.txHash}` : undefined,
        });
        setStep("done");
        onSuccess();
        // If still pending or sent, poll every 5 s until complete/failed.
        if (initialState === "pending" || initialState === "sent") {
          stopPoll();
          pollRef.current = setInterval(() => {
            apiFetch(`/v1/wallet/${userId}`, {}, userId)
              .then((r) => r.json() as Promise<WalletData | { error: string }>)
              .then((data) => {
                if ("error" in data) return;
                const latest = data.withdrawals?.[0];
                if (!latest) return;
                if (latest.state === "complete" || latest.state === "failed") {
                  setResult({
                    state:       latest.state,
                    txHash:      latest.txHash ?? null,
                    explorerUrl: latest.txHash ? `${EXPLORER}/tx/${latest.txHash}` : undefined,
                  });
                  // After a failed result, rotate the key so the next attempt is fresh.
                  if (latest.state === "failed") idempKey.current = crypto.randomUUID();
                  stopPoll();
                  onSuccess();
                } else {
                  setResult((prev) => prev ? { ...prev, state: latest.state } : prev);
                }
              })
              .catch(() => { /* transient — keep polling */ });
          }, 5_000);
        }
      }
    } catch {
      setServerErr("Could not reach the server. Check your connection and try again.");
      setStep("form");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    stopPoll();
    setStep("form");
    setDest("");
    setAmount("");
    setFormErr("");
    setServerErr("");
    setResult(null);
    idempKey.current = crypto.randomUUID();
  };

  return (
    <section className="sticker-card flex flex-col gap-4 p-6" aria-labelledby="wd-head">
      <h2 id="wd-head" className="font-display text-[22px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Withdraw</h2>

      {step === "form" && (
        <>
          <p className="text-[13px] font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
            Available: <strong>{withdrawableDisplay.toFixed(2)} USDC</strong>
            {isTestnet && " (test USDC — no real value)"}
          </p>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="wd-dest" className="text-[13px] font-extrabold" style={{ color: "rgb(var(--ink-2))" }}>Destination address</label>
              <input
                id="wd-dest"
                type="text"
                placeholder="0x…"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                className="w-full rounded-xl px-4 py-3 font-mono text-[13px] outline-none"
                style={{ background: "rgb(var(--cloud-2))", border: "2px solid rgb(var(--ink) / 0.15)", color: "rgb(var(--ink))" }}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="wd-amount" className="text-[13px] font-extrabold" style={{ color: "rgb(var(--ink-2))" }}>Amount (USDC)</label>
              <div className="flex gap-2">
                <input
                  id="wd-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 rounded-xl px-4 py-3 text-[15px] font-extrabold tabular-nums outline-none"
                  style={{ background: "rgb(var(--cloud-2))", border: "2px solid rgb(var(--ink) / 0.15)", color: "rgb(var(--ink))" }}
                />
                <button type="button" onClick={setMax} className="pop-btn pop-btn-ghost shrink-0 px-4 text-[14px]">
                  Max
                </button>
              </div>
            </div>
          </div>

          {formErr && <p className="rounded-lg px-3 py-2 text-[13px] font-semibold" style={{ background: "rgb(var(--coral) / 0.12)", color: "rgb(var(--coral))" }} role="alert">{formErr}</p>}
          {serverErr && <p className="rounded-lg px-3 py-2 text-[13px] font-semibold" style={{ background: "rgb(var(--coral) / 0.12)", color: "rgb(var(--coral))" }} role="alert">{serverErr}</p>}

          <button type="button" onClick={goConfirm} className="pop-btn self-start px-6 text-[15px]">
            Continue
          </button>
        </>
      )}

      {step === "confirm" && (
        <>
          <div className="flex flex-col gap-2 rounded-xl p-4" style={{ background: "rgb(var(--cloud-2))" }}>
            <div className="flex justify-between gap-2 text-[14px]">
              <span className="font-extrabold" style={{ color: "rgb(var(--ink-2))" }}>Amount</span>
              <span className="font-display font-extrabold tabular-nums" style={{ color: "rgb(var(--ink))" }}>{parseFloat(amount).toFixed(2)} USDC</span>
            </div>
            <div className="flex flex-col gap-0.5 text-[13px]">
              <span className="font-extrabold" style={{ color: "rgb(var(--ink-2))" }}>To</span>
              <span className="break-all font-mono" style={{ color: "rgb(var(--ink))" }}>{dest}</span>
            </div>
          </div>

          <div className="rounded-xl px-4 py-3 text-[13px] font-semibold leading-relaxed" style={{ background: "rgb(var(--amber) / 0.15)", color: "rgb(var(--ink-2))", border: "2px solid rgb(var(--amber) / 0.4)" }}>
            Arc network only. Send to an address you control. Transactions on Arc are final, and we can&apos;t reverse them.
          </div>

          {serverErr && <p className="rounded-lg px-3 py-2 text-[13px] font-semibold" style={{ background: "rgb(var(--coral) / 0.12)", color: "rgb(var(--coral))" }} role="alert">{serverErr}</p>}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => { void submit(); }} disabled={busy} className="pop-btn flex-1 px-6 text-[15px]" aria-busy={busy}>
              {busy ? "Sending…" : "Confirm withdrawal"}
            </button>
            <button type="button" onClick={() => setStep("form")} disabled={busy} className="pop-btn pop-btn-ghost flex-1 px-6 text-[15px]">
              Back
            </button>
          </div>
        </>
      )}

      {step === "done" && result && (
        <>
          <div className="flex flex-col gap-2 rounded-xl p-4" style={{ background: "rgb(var(--mint) / 0.15)" }}>
            <p className="font-display text-[18px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>
              {result.state === "complete" ? "Withdrawal complete" : "Withdrawal submitted"}
            </p>
            <p className="text-[14px] font-semibold" style={{ color: "rgb(var(--ink-2))" }}>
              {result.state === "complete"
                ? "The USDC has left your wallet."
                : "The transfer is on its way. It should arrive in a few seconds."}
            </p>
            {result.explorerUrl && result.txHash && (
              <a href={result.explorerUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-[12px] underline" style={{ color: "rgb(var(--violet))" }}>
                {result.txHash.slice(0, 18)}… ↗
              </a>
            )}
          </div>
          <button type="button" onClick={reset} className="pop-btn pop-btn-ghost self-start px-6 text-[14px]">
            Make another withdrawal
          </button>
        </>
      )}
    </section>
  );
}
