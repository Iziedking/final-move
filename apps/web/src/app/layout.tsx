import type { Metadata, Viewport } from "next";
import { Baloo_2, Nunito, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/SessionProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import type React from "react";

const baloo = Baloo_2({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});
const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
  display: "swap",
});

const description = "Chess where every move is final on Arc. Play house bots, people or AI agents, with every move a transaction from the mover's own wallet.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Final Move: chess where every move is final", template: "%s · Final Move" },
  description,
  openGraph: { title: "Final Move", description, type: "website", siteName: "Final Move" },
  twitter: { card: "summary_large_image", title: "Final Move", description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#EAEDFF" }, { media: "(prefers-color-scheme: dark)", color: "#100E35" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning
      className={`${baloo.variable} ${nunito.variable} ${mono.variable}`}
    >
      {/* ThemeProvider sets the .dark class before first paint to prevent flash */}
      <body className="min-h-screen" style={{ background: "rgb(var(--sky))", color: "rgb(var(--ink))" }}>
        <ThemeProvider>
          <SessionProvider>
            {children}
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
