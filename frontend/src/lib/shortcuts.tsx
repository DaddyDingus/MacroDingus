import { createContext, useContext, useState, type ReactNode } from "react";

export type ShortcutId =
  | "quickAdd"
  | "search"
  | "scan"
  | "logWeight"
  | "newRecipe"
  | "recipes"
  | "copyDay"
  | "photos";

export const SHORTCUT_CATALOG: { id: ShortcutId; label: string }[] = [
  { id: "quickAdd", label: "Quick add" },
  { id: "search", label: "Search foods" },
  { id: "scan", label: "Scan barcode" },
  { id: "logWeight", label: "Log weight" },
  { id: "newRecipe", label: "New recipe" },
  { id: "recipes", label: "Recipes" },
  { id: "copyDay", label: "Copy a day" },
  { id: "photos", label: "Photos" },
];

const DEFAULT_SHORTCUTS: ShortcutId[] = ["quickAdd", "search", "scan", "logWeight"];
const MAX_SHORTCUTS = 4;
const STORAGE_KEY = "macrotrack-dashboard-shortcuts";

function isShortcutId(v: unknown): v is ShortcutId {
  return typeof v === "string" && SHORTCUT_CATALOG.some((s) => s.id === v);
}

function load(): ShortcutId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SHORTCUTS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_SHORTCUTS;
    const valid = parsed.filter(isShortcutId).slice(0, MAX_SHORTCUTS);
    return valid.length > 0 ? valid : DEFAULT_SHORTCUTS;
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

interface ShortcutsContextValue {
  shortcuts: ShortcutId[];
  toggle: (id: ShortcutId) => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcuts] = useState<ShortcutId[]>(load);

  function toggle(id: ShortcutId) {
    setShortcuts((prev) => {
      const next = prev.includes(id)
        ? prev.filter((s) => s !== id)
        : prev.length >= MAX_SHORTCUTS
          ? prev
          : [...prev, id];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return <ShortcutsContext.Provider value={{ shortcuts, toggle }}>{children}</ShortcutsContext.Provider>;
}

export function useDashboardShortcuts() {
  const ctx = useContext(ShortcutsContext);
  if (!ctx) throw new Error("useDashboardShortcuts must be used within ShortcutsProvider");
  return ctx;
}

export const MAX_DASHBOARD_SHORTCUTS = MAX_SHORTCUTS;
