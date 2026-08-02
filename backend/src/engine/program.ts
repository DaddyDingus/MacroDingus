import { computeTrend, KCAL_PER_KG } from "./trendWeight.js";
import { macroFactorTdee, estimateAdaptiveTdee, computeMacroTargets } from "./tdee.js";

export type ProteinLevel = "low" | "moderate" | "high" | "extra_high" | "custom";
export type DietType = "balanced" | "low_fat" | "low_carb" | "keto";
export type DistributionMode = "even" | "shifted" | "custom";

// Not MacroFactor's real table (which isn't public) — grounded instead in
// the current sports-nutrition literature, applied per proteinBasis (total
// bodyweight by default, or lean mass — see program.proteinBasis/
// leanBodyMassKg — when a body-fat % is on file):
//   low:        1.4 g/kg — floor of the ISSN 2017 position stand's "1.4-2.0
//               g/kg/day is sufficient for most exercising individuals."
//   moderate:   1.8 g/kg — mid-ISSN-range; above the ~1.62 g/kg breakpoint
//               Morton et al. 2018 (Br J Sports Med meta-analysis/
//               meta-regression, n=1863) found for maximizing resistance-
//               training lean-mass gains, with margin.
//   high:       2.2 g/kg — top of the practical 1.6-2.2 g/kg range implied
//               by Morton et al.'s 95% CI around that breakpoint.
//   extra_high: 2.8 g/kg — within Helms, Zinn, Rodriguez & Phillips 2014
//               (Int J Sport Nutr Exerc Metab systematic review)'s 2.3-3.1
//               g/kg *fat-free mass* range for resistance-trained
//               individuals in a caloric deficit, where protein needs run
//               well above the general-population figures above; most
//               appropriate for a cut, and most literally applied when
//               proteinBasis is 'lean' rather than total bodyweight.
//
// Re-checked (not just re-asserted) against the current literature: Nunes
// et al. 2022 (J Cachexia Sarcopenia Muscle meta-analysis, 74 RCTs) found
// added protein's lean-mass benefit in resistance-trained adults is real
// but modest — consistent with moderate/high sitting around Morton's
// breakpoint rather than needing to move higher. Refalo et al. 2025
// (Strength & Conditioning Journal, updated meta-regression, 29 studies of
// energy-restricted resistance-trained adults) found the dose-response
// relationship between protein intake and fat-free-mass retention during a
// deficit is linear — not a hard plateau — and stronger when protein is
// scaled to fat-free mass specifically, which is exactly what extra_high
// combined with proteinBasis: 'lean' does; this doesn't change the number,
// it reinforces that 2.8 g/kg sitting near the top of Helms' 2.3-3.1 g/kg
// FFM range (rather than the bottom) is the right place for the most
// aggressive tier, not overshooting it.
export const PROTEIN_LEVEL_GRAMS_PER_KG: Record<Exclude<ProteinLevel, "custom">, number> = {
  low: 1.4,
  moderate: 1.8,
  high: 2.2,
  extra_high: 2.8,
};

// Fat-percent floor per diet type. ISSN guidance (and the broader athlete
// nutrition literature) puts a general fat range of 20-35% of calories for
// athletes, with intakes below ~20% associated with reduced testosterone in
// male athletes (see e.g. the low-fat-diet/testosterone literature summarized
// in Whittaker & Wu 2021, J Steroid Biochem Mol Biol). low_fat is set at
// that 20% floor rather than lower. balanced (25%) and low_carb (35%) sit
// within the same 20-35% range; keto (70%) reflects a standard ketogenic
// split (~70-75% fat, ~15-25% protein, ~5-10% carb), not a 20-35%-range diet.
export const DIET_TYPE_FAT_PERCENT: Record<DietType, number> = {
  balanced: 0.25,
  low_fat: 0.2,
  low_carb: 0.35,
  keto: 0.7,
};

export function applyCalorieFloor(calories: number, floorKcal: number): number {
  return Math.max(calories, floorKcal);
}

export function leanBodyMassKg(weightKg: number, bodyFatPercent: number): number {
  return weightKg * (1 - bodyFatPercent / 100);
}

export interface ProgramDayTargets {
  dayOfWeek: number; // 0=Sunday..6=Saturday, matches JS Date.getDay()
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
}

function dayTargetsFromMacros(dayOfWeek: number, macros: ReturnType<typeof computeMacroTargets>): ProgramDayTargets {
  return {
    dayOfWeek,
    targetCalories: macros.calories,
    targetProteinG: macros.proteinG,
    targetCarbsG: macros.carbsG,
    targetFatG: macros.fatG,
  };
}

export function distributeEvenWeek(
  flatCalories: number,
  trendWeightKg: number,
  proteinPerKg: number,
  fatPercent: number,
  floorKcal: number
): ProgramDayTargets[] {
  const dayCalories = applyCalorieFloor(flatCalories, floorKcal);
  const macros = computeMacroTargets(dayCalories, trendWeightKg, proteinPerKg, fatPercent);
  return Array.from({ length: 7 }, (_, dow) => dayTargetsFromMacros(dow, macros));
}

// User-chosen high-calorie days (the wizard's "which days would you like to
// have higher Calorie targets?" step — see programs.shiftedHighDays), not a
// hardcoded weekend assumption. Original heuristic either way — no reference
// for MacroFactor's actual "shift" algorithm was available, so this is an
// invented, documented, fully deterministic one: the chosen highDays get
// calories increased, every other day gets reduced by `shiftPercent`, solved
// so the 7-day total exactly matches what a flat/even week would have
// totaled (lowCount*lowCalories + highCount*highCalories = 7*flatCalories) —
// a common real-world "tighter most days, looser on the days that matter to
// you" pattern, not a reverse-engineered copy of anyone else's algorithm.
// Each day's protein target stays constant across the week (it's
// proteinPerKg * trendWeight, independent of that day's calorie figure, same
// as computeMacroTargets always does) — only fat/carbs absorb the shift.
// Calorie-floor clamping is applied per-day after the split is computed, so
// in extreme floor-triggering edge cases the weekly total may drift slightly
// below the flat-week total — preserving "never below the floor" wins over
// exact total preservation there. highDays must be a non-empty, non-full
// subset of {0..6} (validated by callers — see programs.ts's zod schema);
// degenerates to a flat week if it isn't, rather than dividing by zero.
export function distributeShiftedWeek(
  flatCalories: number,
  trendWeightKg: number,
  proteinPerKg: number,
  fatPercent: number,
  floorKcal: number,
  highDays: Set<number>,
  shiftPercent = 0.15
): ProgramDayTargets[] {
  const highCount = highDays.size;
  const lowCount = 7 - highCount;
  if (highCount === 0 || lowCount === 0) {
    return distributeEvenWeek(flatCalories, trendWeightKg, proteinPerKg, fatPercent, floorKcal);
  }

  const lowCalories = flatCalories * (1 - shiftPercent);
  const highCalories = (7 * flatCalories - lowCount * lowCalories) / highCount;

  return Array.from({ length: 7 }, (_, dow) => {
    const dayCalories = applyCalorieFloor(highDays.has(dow) ? highCalories : lowCalories, floorKcal);
    const macros = computeMacroTargets(dayCalories, trendWeightKg, proteinPerKg, fatPercent);
    return dayTargetsFromMacros(dow, macros);
  });
}

export interface CoachedProgramInput {
  weighIns: { date: string; weightKg: number }[];
  dailyCalories: { date: string; calories: number }[];
  sex: "male" | "female";
  age: number;
  heightCm: number;
  activityLevel: string;
  targetRateKgPerWeek: number;
  dietType: DietType;
  proteinLevel: ProteinLevel;
  // Required when proteinLevel is 'custom' — the user's own g/kg pick from
  // the wizard's slider. Ignored for the four preset levels, which resolve
  // via PROTEIN_LEVEL_GRAMS_PER_KG instead.
  customProteinPerKg?: number;
  // User's own "starting Calories" from the wizard's Calories step, already
  // back-solved into an implied TDEE by the caller (routes/programs.ts).
  // Used in place of the formula estimate — but never in place of a real
  // adaptive estimate, which always wins once there's enough logging
  // history (see the tdee resolution below). Null/undefined when the
  // wizard's own formula estimate was used instead.
  initialTdeeOverrideKcal?: number | null;
  calorieFloorKcal: number;
  distributionMode: "even" | "shifted";
  // Which days get the higher calorie target under 'shifted' — ignored for
  // 'even'. Falls back to the original weekend-only assumption
  // (DEFAULT_SHIFTED_HIGH_DAYS) if 'shifted' is chosen without one, e.g. a
  // program persisted before this field existed.
  shiftedHighDays?: number[];
  proteinBasis: "total" | "lean";
  bodyFatPercent: number | null;
  weeklyExerciseHours: number | null;
}

export const DEFAULT_SHIFTED_HIGH_DAYS = [0, 6]; // Sunday, Saturday

export interface CoachedProgramBreakdown {
  tdee: number;
  usedAdaptiveTdee: boolean;
  tdeeFluxKcal: number | null;
  trendWeightKg: number;
  // The pre-distribution average daily target — "Average Target" in the
  // wizard results screen's reasoning steps, before it's split across days.
  flatTargetCalories: number;
  proteinPerKgUsed: number;
  fatPercentUsed: number;
  // 'lean' only when proteinBasis was 'lean' AND a body fat % was actually
  // on file — otherwise this silently falls back to 'total' (see
  // generateCoachedProgramDays). leanBodyMassKg is populated only when
  // 'lean' was actually used.
  proteinBasisUsed: "total" | "lean";
  leanBodyMassKg: number | null;
  // True when this generation's tdee came from initialTdeeOverrideKcal
  // rather than the formula or real adaptive data — lets the results
  // screen's "Estimated Expenditure" reasoning step word itself correctly
  // ("you set this" vs. "we determined this").
  usedInitialOverride: boolean;
}

export interface CoachedProgramResult {
  days: ProgramDayTargets[];
  breakdown: CoachedProgramBreakdown;
}

// Orchestrates a Coached program's generation end to end — same TDEE
// estimation performCheckin() already does (estimateAdaptiveTdee first,
// mifflinStJeorTdee fallback), then resolves the qualitative
// dietType/proteinLevel inputs to actual numbers and hands off to the
// chosen distribution function. Caller is responsible for the
// "no weigh-ins yet" business-error case (mirrors how performCheckin
// handles that today) — this assumes at least one weigh-in exists.
export function generateCoachedProgramDays(input: CoachedProgramInput): CoachedProgramResult {
  const trend = computeTrend(input.weighIns);
  const trendWeightKg = trend[trend.length - 1].trendKg;

  const adaptive = estimateAdaptiveTdee(input.weighIns, input.dailyCalories);
  const peakWeightKg = Math.max(...input.weighIns.map((w) => w.weightKg));
  const formulaTdee = macroFactorTdee({
    sex: input.sex,
    age: input.age,
    heightCm: input.heightCm,
    weightKg: trendWeightKg,
    activityLevel: input.activityLevel,
    bodyFatPercent: input.bodyFatPercent,
    weeklyExerciseHours: input.weeklyExerciseHours,
    inDeficit: input.targetRateKgPerWeek < 0,
    peakWeightKg,
  });
  const tdee = adaptive?.tdee ?? input.initialTdeeOverrideKcal ?? formulaTdee;
  const usedInitialOverride = adaptive == null && input.initialTdeeOverrideKcal != null;

  const flatTargetCalories = tdee + (input.targetRateKgPerWeek * KCAL_PER_KG) / 7;
  const proteinPerKg = input.proteinLevel === "custom" ? input.customProteinPerKg! : PROTEIN_LEVEL_GRAMS_PER_KG[input.proteinLevel];
  const fatPercent = DIET_TYPE_FAT_PERCENT[input.dietType];

  const useLean = input.proteinBasis === "lean" && input.bodyFatPercent != null;
  const leanKg = useLean ? leanBodyMassKg(trendWeightKg, input.bodyFatPercent!) : null;
  const proteinBasisWeightKg = leanKg ?? trendWeightKg;

  const days =
    input.distributionMode === "shifted"
      ? distributeShiftedWeek(
          flatTargetCalories,
          proteinBasisWeightKg,
          proteinPerKg,
          fatPercent,
          input.calorieFloorKcal,
          new Set(input.shiftedHighDays ?? DEFAULT_SHIFTED_HIGH_DAYS)
        )
      : distributeEvenWeek(flatTargetCalories, proteinBasisWeightKg, proteinPerKg, fatPercent, input.calorieFloorKcal);

  return {
    days,
    breakdown: {
      tdee: Math.round(tdee),
      usedAdaptiveTdee: adaptive !== null,
      tdeeFluxKcal: adaptive ? Math.round(adaptive.fluxKcal) : null,
      trendWeightKg,
      flatTargetCalories: Math.round(applyCalorieFloor(flatTargetCalories, input.calorieFloorKcal)),
      proteinPerKgUsed: proteinPerKg,
      fatPercentUsed: fatPercent,
      proteinBasisUsed: useLean ? "lean" : "total",
      leanBodyMassKg: leanKg !== null ? Math.round(leanKg * 10) / 10 : null,
      usedInitialOverride,
    },
  };
}
