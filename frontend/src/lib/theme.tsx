import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSyncedSetting } from "./useSyncedSetting";

export type Theme = "black" | "graphite" | "cappuccino" | "catppuccin";

const THEME_IDS: Theme[] = ["black", "graphite", "cappuccino", "catppuccin"];
const STORAGE_KEY = "macrotrack-theme";

export const THEME_CATALOG: { id: Theme; label: string; description: string; swatch: string }[] = [
  { id: "black", label: "Black", description: "True black — best for OLED screens", swatch: "#000000" },
  { id: "graphite", label: "Graphite", description: "Dark grey, softer than pure black", swatch: "#17171A" },
  // Swatch is a lighter, more saturated coffee brown than the theme's actual
  // (much darker) --color-bg — a swatch that dark would read as another
  // near-black circle next to the other two, indistinguishable at a glance.
  { id: "cappuccino", label: "Cappuccino Macchiato", description: "Warm espresso brown", swatch: "#6F4E37" },
  // The real Catppuccin Macchiato palette (catppuccin.com) — easy to confuse
  // with "Cappuccino Macchiato" above by name alone (that's the whole reason
  // this one got added), so the description leads with "purple" and the
  // swatch is Catppuccin's own Mauve accent rather than its (much darker,
  // less immediately recognizable) background tone.
  { id: "catppuccin", label: "Catppuccin Macchiato", description: "Purple-blue, cooler and softer than the others", swatch: "#C6A0F6" },
];

// Mirrors index.css's --color-bg per theme — kept in sync manually since the
// <meta name="theme-color"> tag can't read a CSS variable itself.
const THEME_COLOR: Record<Theme, string> = {
  black: "#000000",
  graphite: "#17171A",
  cappuccino: "#1C1512",
  catppuccin: "#181926",
};

function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && THEME_IDS.includes(v as Theme);
}

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isTheme(stored) ? stored : "black";
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  }, [theme]);

  function applyTheme(t: Theme) {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
  }

  // Query is gated on auth (see useSettings) so this is a no-op on
  // LoginScreen, which also mounts ThemeProvider — theme stays purely
  // localStorage-driven until logged in.
  const setTheme = useSyncedSetting("theme", theme, applyTheme, (v) => (isTheme(v) ? v : null));

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
