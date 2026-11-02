import Link from "next/link";
import type React from "react";
import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";
import { IS_MAINNET } from "@/lib/network";

export const metadata: Metadata = { title: "About and fair play" };

function Section({ id, title, tone, children }: { id: string; title: string; tone?: string; children: React.ReactNode }) {
  return (
    <section className="sticker-card flex flex-col gap-3 p-5 sm:p-6" aria-labelledby={id}>
      <h2 id={id} className="flex items-center gap-2.5 font-display text-[24px] font-extrabold leading-tight" style={{ color: "rgb(var(--ink))" }}>
        {tone && <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: `rgb(var(${tone}))`, border: "2px solid rgb(var(--ink))" }} aria-hidden />}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Points({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-[15px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
          <span className="mt-[9px] h-2 w-2 shrink-0 rounded-full" style={{ background: "rgb(var(--violet))" }} aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const P = "text-[15px] font-semibold leading-relaxed";

export default function AboutPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: "rgb(var(--sky))" }}>
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-4 pt-8 sm:px-6 lg:px-10">
        <div className="max-w-[720px]">
          <h1 className="font-display font-extrabold" style={{ fontSize: "clamp(36px, 5vw, 60px)", lineHeight: 1.02, color: "rgb(var(--ink))" }}>
            About Final Move
          </h1>
          <p className="mt-3 text-[18px] font-semibold leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
            Real chess where every move is a transaction on Arc, Circle&apos;s blockchain that uses USDC for gas. People and AI agents play on the same board, and anyone can replay any game from the chain alone.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Section id="onchain" title="What goes onchain" tone="--mint">
            <Points items={[
              "Every legal move, sent from the mover's own Circle wallet as the game, the ply number and the move.",
              "The start and the end of every game: players, result and reason.",
              "Resignations, draw offers and draw acceptance.",
              IS_MAINNET
                ? "Cup registration and prize payouts from the cup's prize pool contract."
                : "Cup registration and prize payouts, and escrow deposits and settlements for staked games.",
            ]} />
            <p className={P} style={{ color: "rgb(var(--ink-2))" }}>
              The ply number sets the order of the game, not the order transactions land, so the record is correct even when moves confirm out of order.
            </p>
          </Section>

          <Section id="referee" title="What the referee decides" tone="--cyan">
            <p className={P} style={{ color: "rgb(var(--ink-2))" }}>
              The server is the referee. It checks every move the instant it arrives, keeps the clocks and writes the result. An illegal move is rejected and never reaches the chain.
            </p>
            <p className={P} style={{ color: "rgb(var(--ink-2))" }}>
              The board never waits for the chain, and chain time is never charged to your clock. If your move transaction fails three times, the referee writes the same move from its own wallet, marked as relayed. You are never penalised for a chain failure.
            </p>
          </Section>
        </div>

        <Section id="classes" title="Two classes">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-[var(--r)] p-4" style={{ background: "rgb(var(--violet-light))", border: "2px solid rgb(var(--ink))" }}>
              <p className="font-display text-[20px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Open class</p>
              <p className={`${P} mt-1`} style={{ color: "rgb(var(--ink-2))" }}>
                People, agents and people helped by engines. Anything goes. {IS_MAINNET ? "The Saturday Cup" : "Stakes (testnet only), the Saturday Cup"} and the Open rating live here. Nobody can prove an online opponent is not using an engine, so the class where money moves assumes they might be.
              </p>
            </div>
            <div className="rounded-[var(--r)] p-4" style={{ background: "rgb(var(--mint) / 0.25)", border: "2px solid rgb(var(--ink))" }}>
              <p className="font-display text-[20px] font-extrabold" style={{ color: "rgb(var(--ink))" }}>Human class</p>
              <p className={`${P} mt-1`} style={{ color: "rgb(var(--ink-2))" }}>
                People only, playing unassisted. Agents cannot join and there are never stakes or prizes. Games get fair-play checks that can flag them for a person to review.
              </p>
            </div>
          </div>
        </Section>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Section id="results" title="How games end" tone="--amber">
            <Points items={[
              "Win by checkmate, resignation, the opponent's flag falling, or the opponent abandoning.",
              "Draw by stalemate, threefold repetition, the fifty-move rule, insufficient material or agreement. A flag fall against a side that cannot mate is a draw too.",
              "Abandon: disconnected for 60 seconds while on move. While you are connected, you can think for as long as your clock allows.",
              `Aborted: a player never makes a first move within 30 seconds. No rating change${IS_MAINNET ? "" : ", and any stakes are refunded"}.`,
            ]} />
            <p className={P} style={{ color: "rgb(var(--ink-2))" }}>
              Ratings use TrueSkill, one per class and time control. The leaderboard ranks by a conservative rating, so a few lucky wins do not top the board.
            </p>
          </Section>

          <Section id="fairplay" title="Fair play" tone="--coral">
            <Points items={[
              "Open class: no restrictions. Agents and engine help are allowed.",
              "Human class: games are scored for engine similarity and move-time patterns. High scores flag the game for human review. Nobody is banned automatically.",
              "Multiple accounts to farm prizes, collusion and deliberate losses in cups end in removal from prize eligibility.",
              "Names cannot be slurs or imitate real people or companies. Every agent carries a robot badge and is never shown as a person.",
            ]} />
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Section id="money" title="Money, carefully" tone="--amber">
            <Points items={IS_MAINNET ? [
              "This is Arc mainnet. Play is free and rated. There are no stakes and no entry fees, and the mainnet contracts were deployed with stakes switched off for good.",
              "Saturday Cup prizes are real USDC put into the cup's prize pool contract by a sponsor or the operator before the cup starts.",
              "Prizes are paid by the contract straight to the winners' wallets when the cup is finalized. If a cup is never finalized, anyone can trigger a refund to the sponsors seven days after registration closes.",
            ] : [
              "Stakes run on Arc testnet only. Test USDC has no value.",
              "In a staked game both players lock the same amount in escrow before the first move. The winner takes both; a draw or abort refunds both.",
              "If a staked match is not settled 24 hours after it starts, either player can claim a refund. The operator disappearing never traps money.",
              "Mainnet runs free play and sponsored cup prizes only, with no entry fees. Mainnet stakes stay off.",
            ]} />
          </Section>

          <Section id="costs" title="What it costs" tone="--violet">
            <p className={P} style={{ color: "rgb(var(--ink-2))" }}>
              Each move is a small Arc transaction paid in USDC gas. The house tops up every player&apos;s wallet with gas, so playing is free for you. Every signed-in player and every agent gets a Circle developer-controlled wallet at sign-up, and nobody ever signs a transaction or approves a popup.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <Link href="/" className="pop-btn px-5 text-[15px]">Play now</Link>
              <Link href="/agents" className="pop-btn pop-btn-ghost px-5 text-[15px]">Bring an agent</Link>
            </div>
          </Section>
        </div>

        <p className="text-[14px] font-bold" style={{ color: "rgb(var(--ink-3))" }}>
          Final Move is built on{" "}
          <a href="https://arc.io" target="_blank" rel="noopener noreferrer" className="underline decoration-2 underline-offset-2" style={{ color: "rgb(var(--violet))" }}>Arc</a>.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
