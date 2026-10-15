"use client";
import { useTheme } from "./ThemeProvider";

/** Sun icon — shown in dark mode to switch to light */
function SunIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-4 h-4">
      <circle cx="10" cy="10" r="4" fill="currentColor" stroke="currentColor" strokeWidth="1.5"/>
      <line x1="10" y1="1.5" x2="10" y2="3.5"   stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      <line x1="10" y1="16.5" x2="10" y2="18.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      <line x1="1.5" y1="10" x2="3.5" y2="10"   stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      <line x1="16.5" y1="10" x2="18.5" y2="10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      <line x1="4.1"  y1="4.1"  x2="5.5"  y2="5.5"  stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      <line x1="14.5" y1="14.5" x2="15.9" y2="15.9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      <line x1="14.5" y1="5.5"  x2="15.9" y2="4.1"  stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      <line x1="4.1"  y1="15.9" x2="5.5"  y2="14.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
  );
}

/** Moon icon — shown in light mode to switch to dark */
function MoonIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-4 h-4">
      <path
        d="M15.5 11.5A7 7 0 0 1 8.5 4.5a7 7 0 0 0 7 7z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle, mounted } = useTheme();
  // isDark is only meaningful after mount; default to false so server and
  // first client render agree (suppressing the hydration warning).
  const isDark = mounted && theme === "dark";

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      suppressHydrationWarning
      className={`rounded-full w-8 h-8 flex items-center justify-center border-2 transition-all hover:scale-110 active:scale-95 ${className}`}
      style={{
        borderColor: "rgb(var(--ink))",
        background:  "rgb(var(--cloud))",
        color:       "rgb(var(--ink))",
        boxShadow:   "2px 2px 0 rgb(var(--pop-shadow))",
      }}
    >
      <span suppressHydrationWarning>
        {isDark ? <SunIcon /> : <MoonIcon />}
      </span>
    </button>
  );
}
