import type { Config } from "tailwindcss";

/* Final Move: Zerun sticker system. Every colour resolves to a CSS variable in
   globals.css (RGB triplets), so light and dark themes share one set of names.
   Fonts come from next/font in app/layout.tsx via --font-display/body/mono. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sky: token("sky"),
        "sky-2": token("sky-2"),
        cloud: token("cloud"),
        "cloud-2": token("cloud-2"),
        ink: token("ink"),
        "ink-2": token("ink-2"),
        "ink-3": token("ink-3"),
        violet: token("violet"),
        "violet-deep": token("violet-deep"),
        "violet-light": token("violet-light"),
        amber: token("amber"),
        mint: token("mint"),
        cyan: token("cyan"),
        coral: token("coral"),
        "candy-ink": token("candy-ink"),
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "Menlo", "monospace"],
      },
      borderWidth: { line: "3px" },
      borderRadius: { sticker: "18px", "sticker-lg": "28px" },
      boxShadow: {
        pop: "4px 4px 0 rgb(var(--pop-shadow))",
        "pop-sm": "2px 2px 0 rgb(var(--pop-shadow))",
        "pop-lg": "6px 6px 0 rgb(var(--pop-shadow))",
        "pop-press": "1px 1px 0 rgb(var(--pop-shadow))",
      },
      transitionTimingFunction: { spring: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
      keyframes: {
        "fade-in": { "0%": { opacity: "0", transform: "scale(0.97)" }, "100%": { opacity: "1", transform: "scale(1)" } },
        "slide-up": { "0%": { opacity: "0", transform: "translateY(10px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        "fade-in": "fade-in 0.18s ease-out both",
        "slide-up": "slide-up 0.22s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
