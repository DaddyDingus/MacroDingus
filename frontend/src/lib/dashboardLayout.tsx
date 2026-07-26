import { createContext, useContext, useState, type ReactNode } from "react";

export type Category = "insights" | "habits" | "nutrition" | "bodyMetrics";

export type TileId =
  | "trendWeight"
  | "expenditure"
  | "energyBalance"
  | "goalProgress"
  | "weighInConsistency"
  | "loggingConsistency"
  | "macros"
  | "calories"
  | "protein"
  | "carbs"
  | "fat"
  | "scaleWeight";

// Fixed, not user-reorderable/toggleable — only the tiles within each are.
export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "insights", label: "Insights & analytics" },
  { id: "habits", label: "Habits" },
  { id: "nutrition", label: "Nutrition" },
  { id: "bodyMetrics", label: "Body metrics" },
];

export const TILE_CATALOG: { id: TileId; category: Category; label: string }[] = [
  { id: "trendWeight", category: "insights", label: "Trend weight" },
  { id: "expenditure", category: "insights", label: "Expenditure" },
  { id: "energyBalance", category: "insights", label: "Energy balance" },
  { id: "goalProgress", category: "insights", label: "Goal progress" },
  { id: "weighInConsistency", category: "habits", label: "Weigh-ins" },
  { id: "loggingConsistency", category: "habits", label: "Food logging" },
  { id: "macros", category: "nutrition", label: "Macros" },
  { id: "calories", category: "nutrition", label: "Calories" },
  { id: "protein", category: "nutrition", label: "Protein" },
  { id: "carbs", category: "nutrition", label: "Carbs" },
  { id: "fat", category: "nutrition", label: "Fat" },
  { id: "scaleWeight", category: "bodyMetrics", label: "Scale weight" },
];

// Unlike shortcuts.tsx's curated-4-of-8 default, this defaults to every tile
// ON — this is a config migration for people already using the app, and
// nothing already visible should silently disappear on upgrade.
const DEFAULT_ORDER: Record<Category, TileId[]> = {
  insights: ["trendWeight", "expenditure", "energyBalance", "goalProgress"],
  habits: ["weighInConsistency", "loggingConsistency"],
  nutrition: ["macros", "calories", "protein", "carbs", "fat"],
  bodyMetrics: ["scaleWeight"],
};

const STORAGE_KEY = "macrotrack-dashboard-layout";

type LayoutState = Record<Category, TileId[]>;

function defaultLayout(): LayoutState {
  return {
    insights: [...DEFAULT_ORDER.insights],
    habits: [...DEFAULT_ORDER.habits],
    nutrition: [...DEFAULT_ORDER.nutrition],
    bodyMetrics: [...DEFAULT_ORDER.bodyMetrics],
  };
}

function isTileId(v: unknown): v is TileId {
  return typeof v === "string" && TILE_CATALOG.some((t) => t.id === v);
}

function load(): LayoutState {
  const result = defaultLayout();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;
    const parsed = JSON.parse(raw);
    // Trust the stored array as-is (filtered for validity) — no attempt to
    // back-fill tiles missing from it. An earlier version of this tried to
    // auto-append any catalog tile absent from storage, reasoning it might be
    // new to the catalog; in practice that's indistinguishable from a tile
    // the user deliberately turned off, so it silently undid every toggle-off
    // on next load. Same trade-off shortcuts.tsx already makes: a tile added
    // to the catalog in a future version won't appear for existing users
    // until they open the editor, which is fine.
    for (const cat of CATEGORIES.map((c) => c.id)) {
      const stored = parsed?.[cat];
      if (!Array.isArray(stored)) continue;
      result[cat] = stored.filter(isTileId).filter((id) => TILE_CATALOG.find((t) => t.id === id)?.category === cat);
    }
    return result;
  } catch {
    return result;
  }
}

interface DashboardLayoutContextValue {
  layout: LayoutState;
  toggle: (category: Category, id: TileId) => void;
  move: (category: Category, id: TileId, direction: "up" | "down") => void;
}

const DashboardLayoutContext = createContext<DashboardLayoutContextValue | null>(null);

export function DashboardLayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<LayoutState>(load);

  function persist(next: LayoutState) {
    setLayout(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function toggle(category: Category, id: TileId) {
    const current = layout[category];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    persist({ ...layout, [category]: next });
  }

  function move(category: Category, id: TileId, direction: "up" | "down") {
    const current = [...layout[category]];
    const idx = current.indexOf(id);
    if (idx === -1) return;
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= current.length) return;
    [current[idx], current[swapWith]] = [current[swapWith], current[idx]];
    persist({ ...layout, [category]: current });
  }

  return <DashboardLayoutContext.Provider value={{ layout, toggle, move }}>{children}</DashboardLayoutContext.Provider>;
}

export function useDashboardLayout() {
  const ctx = useContext(DashboardLayoutContext);
  if (!ctx) throw new Error("useDashboardLayout must be used within DashboardLayoutProvider");
  return ctx;
}
