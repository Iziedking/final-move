"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";
interface ThemeCtxValue { theme: Theme; toggle: () => void; mounted: boolean; }

const ThemeCtx = createContext<ThemeCtxValue>({
  theme: "light",
  toggle: () => {},
  mounted: false,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme]   = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Run only on client — reads localStorage and system preference
    const stored =
      typeof localStorage !== "undefined"
        ? (localStorage.getItem("fm-theme") as Theme | null)
        : null;
    const preferred =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    const initial = stored ?? preferred;
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
    setMounted(true);
  }, []);

  const toggle = () => {
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      localStorage.setItem("fm-theme", next);
      document.documentElement.classList.toggle("dark", next === "dark");
      return next;
    });
  };

  return (
    <ThemeCtx.Provider value={{ theme, toggle, mounted }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() { return useContext(ThemeCtx); }
