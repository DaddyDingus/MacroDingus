import { createContext, useContext, useState, type ReactNode } from "react";
import { useSyncedSetting } from "./useSyncedSetting";

export type WeightUnit = "kg" | "lb";

const STORAGE_KEY = "macrotrack-weight-unit";
const KG_PER_LB = 0.45359237;

interface WeightUnitContextValue {
  unit: WeightUnit;
  setUnit: (u: WeightUnit) => void;
}

const WeightUnitContext = createContext<WeightUnitContextValue | null>(null);

export function WeightUnitProvider({ children }: { children: ReactNode }) {
  const [unit, setUnitState] = useState<WeightUnit>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "lb" ? "lb" : "kg";
  });

  function applyUnit(u: WeightUnit) {
    setUnitState(u);
    localStorage.setItem(STORAGE_KEY, u);
  }

  const setUnit = useSyncedSetting("weightUnit", unit, applyUnit, (v) => (v === "kg" || v === "lb" ? v : null));

  return <WeightUnitContext.Provider value={{ unit, setUnit }}>{children}</WeightUnitContext.Provider>;
}

export function useWeightUnit() {
  const ctx = useContext(WeightUnitContext);
  if (!ctx) throw new Error("useWeightUnit must be used within WeightUnitProvider");
  return ctx;
}

// The backend always stores/returns kg — these convert purely for display and
// input, so nothing about the data model or API needs to know a preference
// exists at all.
export function kgToUnit(kg: number, unit: WeightUnit): number {
  return unit === "kg" ? kg : kg / KG_PER_LB;
}

export function unitToKg(value: number, unit: WeightUnit): number {
  return unit === "kg" ? value : value * KG_PER_LB;
}

// A rate of weight change, as a magnitude with its unit and no sign — every
// caller so far sits in a sentence that already says which direction it's
// going ("lose about 0.55 kg per week"), where a leading minus reads as a
// typo. Two decimals in kg, one in lb: a kg/week rate is a small number where
// the second digit is the whole distinction between 0.55 and 0.6, while the
// same figure in lb is roughly twice as large and doesn't need it.
export function formatRate(kgPerWeek: number, unit: WeightUnit): string {
  const value = Math.abs(kgToUnit(kgPerWeek, unit));
  return `${value.toFixed(unit === "kg" ? 2 : 1)} ${unit}`;
}
