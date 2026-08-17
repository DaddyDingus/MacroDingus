import { computeTrend, KCAL_PER_KG } from "./trendWeight.js";
import { macroFactorTdee, estimateAdaptiveTdee, computeMacroTargets } from "./tdee.js";

export type ProteinLevel = "low" | "moderate" | "high" | "extra_high" | "custom";
export type DietType = "balanced" | "low_fat" | "low_carb" | "keto";
export type DistributionMode = "even" | "shifted" | "custom";

// Not MacroFactor's real table (which isn't public). The evidence uses two
// different denominators, so the presets must too — applying the same number
// to total and lean weight quietly under-feeds the lean-mass option.
// Total bodyweight: 1.6–2.8 g/kg/day keeps the lower end at the practical
// muscle-gain breakpoint. Lean body mass: 2.3–3.1 g/kg/day is the range
// ISSN cites for resistance-trained people in a calorie deficit.
//
// This deliberately keeps a total-weight and a lean-mass scale separate:
// 1.6 g/kg is a useful total-bodyweight minimum for hypertrophy, but would
// be too low when expressed per kilogram of fat-free mass during a cut.
export const PROTEIN_LEVEL_GRAMS_PER_KG: Record<"total" | "lean", Record<Exclude<ProteinLevel, "custom">, number>> = {
  total: { low: 1.6, moderate: 1.8, high: 2.2, extra_high: 2.8 },
  lean: { low: 2.3, moderate: 2.6, high: 2.8, extra_high: 3.1 },
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

// The deficit depth, as a share of measured expenditure, past which the app
// says something. **Advisory only — nothing clamps to it.** A goal's rate is
// the user's decision and the generated targets always deliver exactly the
// rate that was asked for; this only decides when to point out that the rate
// implies an unusually deep deficit.
//
// It was briefly a hard cap (2026-08-17, same day) and that was wrong: it
// silently converted a chosen -0.8 kg/week into -0.64, and reported the
// substitution in a note *after* the fact. A rate the user sets is a contract.
// The real gap it was reaching for is genuine and remains closed by the flag
// below — before this, nothing anywhere in the app had an opinion about
// deficit *depth* at all. A goal's rate is fixed in kg/week, so the deficit is
// a fixed kcal subtraction no matter what expenditure turns out to be; as
// adaptive TDEE falls (exactly what it is built to detect), that constant
// becomes a larger and larger share of a shrinking number. programs.
// calorieFloorKcal is an absolute number (1200) and never binds first above
// roughly 60 kg, so nothing else would ever mention it.
//
// 25% is where the cutting literature this file cites elsewhere starts to get
// uncomfortable (Helms, Aragon & Fitschen 2014 put contest-prep deficits
// around 20-25% of maintenance; past that, lean-mass retention, training
// quality and adherence measurably degrade). A warning threshold, not a limit.
//
// Surplus is deliberately not flagged: the clinical argument here is about
// under-eating, and an overshooting bulk fails safe at the next check-in in a
// way an overshooting cut does not.
export const DEEP_DEFICIT_FRACTION = 0.25;

// How far below expenditure a target sits, as a fraction. Positive for a
// deficit, negative for a surplus, 0 at maintenance. Returns 0 rather than
// dividing when there's no expenditure to measure against.
export function deficitFractionOf(flatCalories: number, tdee: number): number {
  if (tdee <= 0) return 0;
  return (tdee - flatCalories) / tdee;
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
  // Used only while regenerating an existing program, so revised presets do
  // not silently rewrite the protein target it was created with.
  resolvedProteinPerKg?: number;
  // Daily grams already prescribed by an existing program. Check-ins refresh
  // calories/carbs/fat from new expenditure data, but retain this protein
  // anchor instead of moving it with every scale-weight change.
  proteinTargetGOverride?: number;
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
  // How far below expenditure these targets sit (0.31 = a 31% deficit).
  // Negative for a surplus. Reported always, so a UI can show the depth
  // without recomputing it from two other fields.
  deficitFraction: number;
  // deficitFraction is past DEEP_DEFICIT_FRACTION. Purely advisory — the
  // targets are unaffected either way. Surfaced so the user can decide, since
  // deciding is the whole point of not clamping.
  deepDeficit: boolean;
  // The weight change per week this program's final average target actually
  // implies. Equal to the goal's targetRateKgPerWeek unless the absolute
  // calorie floor bound — the only thing that can still move it.
  effectiveRateKgPerWeek: number;
  proteinPerKgUsed: number;
  targetProteinG: number;
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

  // The goal's rate, delivered as asked. Nothing adjusts this but the
  // program's own absolute calorie floor.
  const flatTargetCalories = tdee + (input.targetRateKgPerWeek * KCAL_PER_KG) / 7;
  const selectedProteinPerKg = input.resolvedProteinPerKg ?? (input.proteinLevel === "custom"
    ? input.customProteinPerKg!
    : PROTEIN_LEVEL_GRAMS_PER_KG[input.proteinBasis][input.proteinLevel]);
  const fatPercent = DIET_TYPE_FAT_PERCENT[input.dietType];

  const useLean = input.proteinBasis === "lean" && input.bodyFatPercent != null;
  const leanKg = useLean ? leanBodyMassKg(trendWeightKg, input.bodyFatPercent!) : null;
  const proteinBasisWeightKg = leanKg ?? trendWeightKg;
  const targetProteinG = input.proteinTargetGOverride ?? selectedProteinPerKg * proteinBasisWeightKg;
  // The macro distributor accepts g/kg, so translate the fixed daily target
  // back to an equivalent rate for today's body composition. This preserves
  // grams across check-ins; only an impossibly low calorie target can cap it.
  const proteinPerKg = targetProteinG / proteinBasisWeightKg;

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

  // Measured after the floor, so the reported depth and rate always describe
  // the targets the program actually holds.
  const finalFlatCalories = applyCalorieFloor(flatTargetCalories, input.calorieFloorKcal);
  const deficitFraction = deficitFractionOf(finalFlatCalories, tdee);

  return {
    days,
    breakdown: {
      tdee: Math.round(tdee),
      usedAdaptiveTdee: adaptive !== null,
      tdeeFluxKcal: adaptive ? Math.round(adaptive.fluxKcal) : null,
      trendWeightKg,
      flatTargetCalories: Math.round(finalFlatCalories),
      deficitFraction: Math.round(deficitFraction * 1000) / 1000,
      deepDeficit: deficitFraction > DEEP_DEFICIT_FRACTION,
      effectiveRateKgPerWeek: Math.round((((finalFlatCalories - tdee) * 7) / KCAL_PER_KG) * 100) / 100,
      proteinPerKgUsed: proteinPerKg,
      // Report the delivered target (rather than the uncapped intent) so the
      // results explanation always agrees with the visible program grid.
      targetProteinG: days[0]?.targetProteinG ?? Math.round(targetProteinG * 10) / 10,
      fatPercentUsed: fatPercent,
      proteinBasisUsed: useLean ? "lean" : "total",
      leanBodyMassKg: leanKg !== null ? Math.round(leanKg * 10) / 10 : null,
      usedInitialOverride,
    },
  };
}
