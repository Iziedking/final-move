import type { Config } from "tailwindcss";

/* Standalone config for apps/web.
   Does NOT extend the Zerun baseConfig (that injects lavender sky/violet/candy tokens).
   All Final Move tokens are resolved via CSS variables defined in globals.css. */
const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        fm: {
          canvas:       "rgb(var(--fm-canvas) / <alpha-value>)",
          "canvas-2":   "rgb(var(--fm-canvas-2) / <alpha-value>)",
          surface:      "rgb(var(--fm-surface) / <alpha-value>)",
          "surface-2":  "rgb(var(--fm-surface-2) / <alpha-value>)",
          ink:          "rgb(var(--fm-ink) / <alpha-value>)",
          ink2:         "rgb(var(--fm-ink-2) / <alpha-value>)",
          ink3:         "rgb(var(--fm-ink-3) / <alpha-value>)",
          green:        "rgb(var(--fm-green) / <alpha-value>)",
          "green-mid":  "rgb(var(--fm-green-mid) / <alpha-value>)",
          "green-light":"rgb(var(--fm-green-light) / <alpha-value>)",
          gold:         "rgb(var(--fm-gold) / <alpha-value>)",
          "gold-light": "rgb(var(--fm-gold-light) / <alpha-value>)",
          "sq-light":   "rgb(var(--fm-sq-light) / <alpha-value>)",
          "sq-dark":    "rgb(var(--fm-sq-dark) / <alpha-value>)",
          success:      "rgb(var(--fm-success) / <alpha-value>)",
          danger:       "rgb(var(--fm-danger) / <alpha-value>)",
          draw:         "rgb(var(--fm-draw) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        sans:    ['"DM Sans"', "system-ui", "sans-serif"],
        mono:    ['"JetBrains Mono"', "Menlo", "monospace"],
      },
      borderRadius: {
        card: "14px",
        modal: "20px",
      },
      boxShadow: {
        card:  "0 1px 3px rgb(0 0 0 / 0.07), 0 4px 12px rgb(0 0 0 / 0.05)",
        modal: "0 8px 40px rgb(0 0 0 / 0.14)",
        inset: "inset 0 1px 3px rgb(0 0 0 / 0.07)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in":  "fade-in 0.18s ease-out both",
        "slide-up": "slide-up 0.22s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
