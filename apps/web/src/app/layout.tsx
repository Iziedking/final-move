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

export const metadata: Metadata = {
  title: "Final Move — Every move is a transaction on Arc",
  description: "Chess where every move is an onchain transaction on Arc.",
  openGraph: {
    title: "Final Move",
    description: "Every move is a transaction on Arc.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
