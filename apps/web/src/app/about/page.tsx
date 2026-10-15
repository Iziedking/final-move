import Link from "next/link";
import type React from "react";
import type { Metadata } from "next";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = { title: "About & Fair Play — Final Move" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="sticker-card p-5 flex flex-col gap-3">
      <h2 className="font-display font-extrabold text-xl" style={{ color: "rgb(var(--ink))" }}>{title}</h2>
      {children}
    </section>
  );
}

export default function AboutPage(): React.JSX.Element {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "rgb(var(--sky))" }}>
      <header
        className="flex items-center justify-between px-4 py-3 border-b-2"
        style={{ background: "rgb(var(--cloud) / 0.85)", borderColor: "rgb(var(--ink) / 0.10)" }}
      >
        <Link href="/" className="font-display font-extrabold text-xl" style={{ color: "rgb(var(--ink))" }}>Final Move</Link>
        <ThemeToggle />
      </header>

      <main className="max-w-2xl mx-auto w-full px-4 py-8 flex flex-col gap-5">
        <h1 className="font-display font-extrabold text-3xl" style={{ color: "rgb(var(--ink))" }}>About Final Move</h1>
        <p className="text-sm font-medium leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
          Final Move is a chess platform where <strong>every move is a transaction on Arc</strong> — Circle&apos;s
          blockchain where USDC is the native gas token. Each move is submitted to the Arc network and
          recorded permanently onchain. Anyone can verify the complete game history without trusting the server.
        </p>

        <Section title="What is onchain">
          <ul className="flex flex-col gap-2 text-sm font-medium leading-relaxed list-none" style={{ color: "rgb(var(--ink-2))" }}>
            {[
              "Every legal chess move — submitted from the mover's own Circle wallet.",
              "Game start and end — result, reason, and final position hash.",
              "Tournament registration, brackets, and prize payouts.",
              "Match escrow deposits and settlements for staked games.",
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span className="font-extrabold mt-0.5" style={{ color: "rgb(var(--teal))" }}>✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="What the referee decides">
          <p className="text-sm font-medium leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
            The referee server enforces chess rules, validates legal moves, manages clocks,
            and calls the onchain contracts. Clock management and move legality are off-chain decisions;
            the blockchain records the final sequence both players produced.
          </p>
          <p className="text-sm font-medium leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
            The referee&apos;s wallet address is public and its calls are visible onchain.
            In future versions, move legality will be enforced in a ZK circuit.
          </p>
        </Section>

        <Section title="Game classes">
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border-l-4 pl-4 py-2" style={{ borderColor: "rgb(var(--teal))" }}>
              <p className="text-sm font-extrabold font-display" style={{ color: "rgb(var(--ink))" }}>Open class</p>
              <p className="text-sm font-medium" style={{ color: "rgb(var(--ink-2))" }}>
                Humans, agents, and engine assistance allowed. Eligible for stakes, tournaments,
                and the Open rating. Games are analysed but not reviewed for fair play.
              </p>
            </div>
            <div className="rounded-xl border-l-4 pl-4 py-2" style={{ borderColor: "rgb(var(--mint))" }}>
              <p className="text-sm font-extrabold font-display" style={{ color: "rgb(var(--ink))" }}>Human class</p>
              <p className="text-sm font-medium" style={{ color: "rgb(var(--ink-2))" }}>
                Humans only. No engine assistance. Every game is automatically reviewed for
                statistical anomalies. Stakes are disabled in the Human class.
              </p>
            </div>
          </div>
        </Section>

        <Section title="Money rules">
          <ul className="flex flex-col gap-2 text-sm font-medium leading-relaxed list-none" style={{ color: "rgb(var(--ink-2))" }}>
            {[
              "Stakes run on Arc testnet only. Testnet USDC has no monetary value.",
              "Tournament prizes on mainnet are funded by sponsors or the operator, never from entry fees.",
              "The owner/referee wallet cannot withdraw from escrow or prize pools.",
              "Staked funds are held in the MatchEscrow contract; settlement is atomic.",
              "All prize splits are set at tournament creation and enforced by TournamentPool.",
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span className="font-extrabold mt-0.5" style={{ color: "rgb(var(--amber))" }}>◆</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Fair play">
          <p className="text-sm font-medium leading-relaxed" style={{ color: "rgb(var(--ink-2))" }}>
            Human-class games are scored automatically. The fair-play engine compares move choices
            against a reference engine at the position&apos;s depth. Accounts with a correlation score
            above the threshold are suspended pending manual review. Decisions can be appealed via
            the support link below.
          </p>
          <p className="text-xs font-semibold" style={{ color: "rgb(var(--ink-3))" }}>
            Agents are not subject to Human-class fair-play review; they should play in the Open class.
          </p>
        </Section>

        <footer className="text-center text-xs font-semibold pt-4 border-t-2" style={{ borderColor: "rgb(var(--ink) / 0.10)", color: "rgb(var(--ink-3))" }}>
          <p>Final Move is built on <a href="https://arc.io" className="hover:underline font-bold" style={{ color: "rgb(var(--teal))" }}>Arc</Link> by Circle.</p>
          <p className="mt-1">Pieces: Lichess cburnett set, CC BY-SA 3.0.</p>
        </footer>
      </main>
    </div>
  );
}
