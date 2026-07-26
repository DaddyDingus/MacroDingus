import { createContext, useContext, useState, type ReactNode } from "react";
import { Zap, Search, ScanBarcode, Scale, ChefHat, BookOpen, CalendarPlus, Camera, type LucideIcon } from "lucide-react";

export type ShortcutId =
  | "quickAdd"
  | "search"
  | "scan"
  | "logWeight"
  | "newRecipe"
  | "recipes"
  | "copyDay"
  | "photos";

export const SHORTCUT_CATALOG: { id: ShortcutId; label: string; icon: LucideIcon }[] = [
  { id: "quickAdd", label: "Quick add", icon: Zap },
  { id: "search", label: "Search foods", icon: Search },
  { id: "scan", label: "Scan barcode", icon: ScanBarcode },
  { id: "logWeight", label: "Log weight", icon: Scale },
  { id: "newRecipe", label: "New recipe", icon: ChefHat },
  { id: "recipes", label: "Recipes", icon: BookOpen },
  { id: "copyDay", label: "Copy a day", icon: CalendarPlus },
  { id: "photos", label: "Photos", icon: Camera },
];

const DEFAULT_SHORTCUTS: ShortcutId[] = ["quickAdd", "search", "scan", "logWeight"];
const MAX_SHORTCUTS = 4;
const STORAGE_KEY = "macrotrack-dashboard-shortcuts";
const COLOR_STORAGE_KEY = "macrotrack-dashboard-shortcut-colors";

// Reuses the app's existing categorical palette (tailwind.config.js) rather
// than introducing new colors — "default" is the current plain grey chip.
// Icon color per swatch is pre-picked for contrast (checked against WCAG's
// 3:1 non-text minimum): fat's yellow and accent's teal are light enough to
// need a black icon, everything else keeps the white icon.
export type ShortcutColorId = "default" | "calories" | "protein" | "carbs" | "fat" | "weight" | "accent";

export const SHORTCUT_COLOR_CATALOG: { id: ShortcutColorId; label: string; hex: string; icon: "black" | "white" }[] = [
  { id: "default", label: "Default", hex: "#2C2C2E", icon: "white" },
  { id: "calories", label: "Blue", hex: "#3987E5", icon: "white" },
  { id: "protein", label: "Orange", hex: "#D95926", icon: "white" },
  { id: "carbs", label: "Green", hex: "#059669", icon: "white" },
  { id: "fat", label: "Yellow", hex: "#F0B400", icon: "black" },
  { id: "weight", label: "Purple", hex: "#9085E9", icon: "white" },
  { id: "accent", label: "Teal", hex: "#6BE4C0", icon: "black" },
];

function isShortcutId(v: unknown): v is ShortcutId {
  return typeof v === "string" && SHORTCUT_CATALOG.some((s) => s.id === v);
}

function isShortcutColorId(v: unknown): v is ShortcutColorId {
  return typeof v === "string" && SHORTCUT_COLOR_CATALOG.some((c) => c.id === v);
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

function loadColors(): Partial<Record<ShortcutId, ShortcutColorId>> {
  try {
    const raw = localStorage.getItem(COLOR_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: Partial<Record<ShortcutId, ShortcutColorId>> = {};
    for (const [id, color] of Object.entries(parsed)) {
      if (isShortcutId(id) && isShortcutColorId(color)) result[id] = color;
    }
    return result;
  } catch {
    return {};
  }
}

interface ShortcutsContextValue {
  shortcuts: ShortcutId[];
  toggle: (id: ShortcutId) => void;
  colors: Partial<Record<ShortcutId, ShortcutColorId>>;
  setColor: (id: ShortcutId, color: ShortcutColorId) => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcuts] = useState<ShortcutId[]>(load);
  const [colors, setColors] = useState<Partial<Record<ShortcutId, ShortcutColorId>>>(loadColors);

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

  function setColor(id: ShortcutId, color: ShortcutColorId) {
    setColors((prev) => {
      const next = { ...prev };
      if (color === "default") {
        delete next[id];
      } else {
        next[id] = color;
      }
      localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return (
    <ShortcutsContext.Provider value={{ shortcuts, toggle, colors, setColor }}>{children}</ShortcutsContext.Provider>
  );
}

export function useDashboardShortcuts() {
  const ctx = useContext(ShortcutsContext);
  if (!ctx) throw new Error("useDashboardShortcuts must be used within ShortcutsProvider");
  return ctx;
}

export const MAX_DASHBOARD_SHORTCUTS = MAX_SHORTCUTS;
