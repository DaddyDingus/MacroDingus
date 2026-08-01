import { createContext, useContext, useState, type ReactNode } from "react";
import { useSyncedSetting } from "./useSyncedSetting";

export type EnergyUnit = "kcal" | "kj";

const STORAGE_KEY = "macrotrack-energy-unit";
const KCAL_PER_KJ = 1 / 4.184;

interface EnergyUnitContextValue {
  unit: EnergyUnit;
  setUnit: (u: EnergyUnit) => void;
}

const EnergyUnitContext = createContext<EnergyUnitContextValue | null>(null);

export function EnergyUnitProvider({ children }: { children: ReactNode }) {
  const [unit, setUnitState] = useState<EnergyUnit>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "kj" ? "kj" : "kcal";
  });

  function applyUnit(u: EnergyUnit) {
    setUnitState(u);
    localStorage.setItem(STORAGE_KEY, u);
  }

  const setUnit = useSyncedSetting("energyUnit", unit, applyUnit, (v) => (v === "kcal" || v === "kj" ? v : null));

  return <EnergyUnitContext.Provider value={{ unit, setUnit }}>{children}</EnergyUnitContext.Provider>;
}

export function useEnergyUnit() {
  const ctx = useContext(EnergyUnitContext);
  if (!ctx) throw new Error("useEnergyUnit must be used within EnergyUnitProvider");
  return ctx;
}

// The backend always stores/returns kcal (foods.caloriesPer100g, checkins'
// target/TDEE columns, etc.) — these convert purely for display and input,
// same "nothing about the data model knows a preference exists" split
// lib/weightUnit.tsx already established for kg/lb.
export function kcalToUnit(kcal: number, unit: EnergyUnit): number {
  return unit === "kcal" ? kcal : kcal / KCAL_PER_KJ;
}

export function unitToKcal(value: number, unit: EnergyUnit): number {
  return unit === "kcal" ? value : value * KCAL_PER_KJ;
}

export function energyUnitLabel(unit: EnergyUnit): string {
  return unit === "kcal" ? "kcal" : "kJ";
}

// Rounded, ready-to-render "296 kcal" / "1238 kJ" — the one formatting path
// every display spot below is meant to share, so a future rounding-rule
// change (or a switch to e.g. rounding kJ to the nearest 10) only needs to
// happen here once.
export function formatEnergy(kcal: number, unit: EnergyUnit): string {
  return `${Math.round(kcalToUnit(kcal, unit)).toLocaleString()} ${energyUnitLabel(unit)}`;
}
