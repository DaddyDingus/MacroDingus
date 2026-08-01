import { createContext, useContext, useState, type ReactNode } from "react";
import { Zap, Search, ScanBarcode, Scale, ChefHat, UtensilsCrossed, BookOpen, CalendarPlus, Camera, Sparkles, type LucideIcon } from "lucide-react";
import { useSyncedSetting } from "./useSyncedSetting";

export type ShortcutId =
  | "quickAdd"
  | "search"
  | "scan"
  | "describe"
  | "logWeight"
  | "newFood"
  | "newRecipe"
  | "recipes"
  | "copyDay"
  | "photos";

export const SHORTCUT_CATALOG: { id: ShortcutId; label: string; icon: LucideIcon }[] = [
  { id: "quickAdd", label: "Quick add", icon: Zap },
  { id: "search", label: "Search foods", icon: Search },
  { id: "scan", label: "Scan barcode", icon: ScanBarcode },
  { id: "describe", label: "Describe a meal", icon: Sparkles },
  { id: "logWeight", label: "Log weight", icon: Scale },
  { id: "newFood", label: "New food", icon: UtensilsCrossed },
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
// 3:1 non-text minimum): fat's yellow and accent's lilac are light enough to
// need a black icon, everything else keeps the white icon. accent's label is
// "Lilac", not "Purple" — weight already has that label, and the two hexes
// were deliberately chosen to actually look different (see tailwind.config.js),
// so the names shouldn't collide either.
export type ShortcutColorId = "default" | "calories" | "protein" | "carbs" | "fat" | "weight" | "accent";

export const SHORTCUT_COLOR_CATALOG: { id: ShortcutColorId; label: string; hex: string; icon: "black" | "white" }[] = [
  // "rgb(var(...))" rather than a literal hex — this is the app's shared
  // divider/chip token (see tailwind.config.js / index.css), so it follows
  // the black/graphite theme picker instead of staying pinned to black.
  { id: "default", label: "Default", hex: "rgb(var(--color-divider))", icon: "white" },
  { id: "calories", label: "Blue", hex: "#749EF4", icon: "black" },
  { id: "protein", label: "Orange", hex: "#EF8D6A", icon: "black" },
  { id: "carbs", label: "Green", hex: "#5ABC80", icon: "black" },
  { id: "fat", label: "Yellow", hex: "#F7D372", icon: "black" },
  { id: "weight", label: "Purple", hex: "#9085E9", icon: "white" },
  { id: "accent", label: "Lilac", hex: "#D896FF", icon: "black" },
];

function isShortcutId(v: unknown): v is ShortcutId {
  return typeof v === "string" && SHORTCUT_CATALOG.some((s) => s.id === v);
}

function isShortcutColorId(v: unknown): v is ShortcutColorId {
  return typeof v === "string" && SHORTCUT_COLOR_CATALOG.some((c) => c.id === v);
}

// Shared by localStorage parsing and the account-settings sync path (a
// server-stored value goes through the exact same untrusted-JSON shape
// concerns as a localStorage one) — null means "not a usable value", which
// the two callers below handle differently (fall back to a default locally;
// treat as "nothing saved yet" when syncing).
function sanitizeShortcuts(parsed: unknown): ShortcutId[] | null {
  if (!Array.isArray(parsed)) return null;
  const valid = parsed.filter(isShortcutId).slice(0, MAX_SHORTCUTS);
  return valid.length > 0 ? valid : null;
}

function sanitizeColors(parsed: unknown): Partial<Record<ShortcutId, ShortcutColorId>> | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const result: Partial<Record<ShortcutId, ShortcutColorId>> = {};
  for (const [id, color] of Object.entries(parsed)) {
    if (isShortcutId(id) && isShortcutColorId(color)) result[id] = color;
  }
  return result;
}

function load(): ShortcutId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SHORTCUTS;
    return sanitizeShortcuts(JSON.parse(raw)) ?? DEFAULT_SHORTCUTS;
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

function loadColors(): Partial<Record<ShortcutId, ShortcutColorId>> {
  try {
    const raw = localStorage.getItem(COLOR_STORAGE_KEY);
    if (!raw) return {};
    return sanitizeColors(JSON.parse(raw)) ?? {};
  } catch {
    return {};
  }
}

interface ShortcutsContextValue {
  shortcuts: ShortcutId[];
  toggle: (id: ShortcutId) => void;
  reorder: (id: ShortcutId, toIndex: number) => void;
  colors: Partial<Record<ShortcutId, ShortcutColorId>>;
  setColor: (id: ShortcutId, color: ShortcutColorId) => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcutsState] = useState<ShortcutId[]>(load);
  const [colors, setColorsState] = useState<Partial<Record<ShortcutId, ShortcutColorId>>>(loadColors);

  function applyShortcuts(next: ShortcutId[]) {
    setShortcutsState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  function applyColors(next: Partial<Record<ShortcutId, ShortcutColorId>>) {
    setColorsState(next);
    localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify(next));
  }

  const syncShortcuts = useSyncedSetting("dashboardShortcuts", shortcuts, applyShortcuts, sanitizeShortcuts);
  const syncColors = useSyncedSetting("dashboardShortcutColors", colors, applyColors, sanitizeColors);

  function toggle(id: ShortcutId) {
    const next = shortcuts.includes(id)
      ? shortcuts.filter((s) => s !== id)
      : shortcuts.length >= MAX_SHORTCUTS
        ? shortcuts
        : [...shortcuts, id];
    syncShortcuts(next);
  }

  // Same splice-out/splice-in pattern as useDashboardLayout's own reorder —
  // this list has no categories to key off of, just the one flat pinned
  // order, so it's a direct index move rather than a per-category lookup.
  function reorder(id: ShortcutId, toIndex: number) {
    const next = [...shortcuts];
    const fromIndex = next.indexOf(id);
    if (fromIndex === -1 || fromIndex === toIndex) return;
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, id);
    syncShortcuts(next);
  }

  function setColor(id: ShortcutId, color: ShortcutColorId) {
    const next = { ...colors };
    if (color === "default") {
      delete next[id];
    } else {
      next[id] = color;
    }
    syncColors(next);
  }

  return (
    <ShortcutsContext.Provider value={{ shortcuts, toggle, reorder, colors, setColor }}>{children}</ShortcutsContext.Provider>
  );
}

export function useDashboardShortcuts() {
  const ctx = useContext(ShortcutsContext);
  if (!ctx) throw new Error("useDashboardShortcuts must be used within ShortcutsProvider");
  return ctx;
}

export const MAX_DASHBOARD_SHORTCUTS = MAX_SHORTCUTS;
