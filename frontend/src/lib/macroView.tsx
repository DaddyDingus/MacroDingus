import { createContext, useContext, useState, type ReactNode } from "react";
import { useSyncedSetting } from "./useSyncedSetting";

// Which page of every swipeable macro bar (DashboardTotalsArcCard's Home
// arc, MacroSummaryBar's Food Log header) shows first — the other is still
// one swipe away either way. Same Context+localStorage+account-sync pattern
// as energyUnit.tsx/weightUnit.tsx.
export type MacroView = "remaining" | "consumed";

const STORAGE_KEY = "macrotrack-macro-view";

interface MacroViewContextValue {
  view: MacroView;
  setView: (v: MacroView) => void;
}

const MacroViewContext = createContext<MacroViewContextValue | null>(null);

export function MacroViewProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<MacroView>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "consumed" ? "consumed" : "remaining";
  });

  function applyView(v: MacroView) {
    setViewState(v);
    localStorage.setItem(STORAGE_KEY, v);
  }

  const setView = useSyncedSetting("defaultMacroView", view, applyView, (v) =>
    v === "remaining" || v === "consumed" ? v : null
  );

  return <MacroViewContext.Provider value={{ view, setView }}>{children}</MacroViewContext.Provider>;
}

export function useMacroView() {
  const ctx = useContext(MacroViewContext);
  if (!ctx) throw new Error("useMacroView must be used within MacroViewProvider");
  return ctx;
}
