import type { WeightUnit } from "./weightUnit";

export type LengthUnit = "cm" | "in";

const CM_PER_IN = 2.54;

// Tape-measure unit follows the scale unit — kg pairs with cm, lb with in —
// same convention the companion measurement app uses, rather than a second independent
// preference nobody would ever set differently.
export function lengthUnitFor(weightUnit: WeightUnit): LengthUnit {
  return weightUnit === "lb" ? "in" : "cm";
}

// Backend always stores/returns cm — these convert purely for display and
// input, mirroring kgToUnit/unitToKg.
export function cmToUnit(cm: number, unit: LengthUnit): number {
  return unit === "cm" ? cm : cm / CM_PER_IN;
}

export function unitToCm(value: number, unit: LengthUnit): number {
  return unit === "cm" ? value : value * CM_PER_IN;
}
