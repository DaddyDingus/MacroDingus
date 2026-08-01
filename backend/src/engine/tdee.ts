import { computeTrend, daysBetween, addDaysToDateString, KCAL_PER_KG } from "./trendWeight.js";

export const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

// MacroFactor's published allometric BMR equation (Formula 1 — height/weight
// only, no body composition data required). Used as the TDEE fallback before
// there's enough logging history for estimateAdaptiveTdee to work with.
// Allometric scaling (power exponents) is more accurate than linear equations
// at body weight extremes. Age term is piecewise: 1.96 kcal/yr up to 60,
// 4.9 kcal/yr beyond (slope accelerates after 60, not a step jump).
// Metabolic adaptation multipliers (deficit ×0.95, >10% below peak ×0.97)
// are not applied here — they require goal and weight-history context the
// engine doesn't thread through to this level.
// Source: macrofactor.com/macrofactors-bmr/
// MacroFactor's three published BMR formulas (macrofactor.com/macrofactors-bmr/,
// shipped in app v2.9.8, August 2024). Formula selected by available data:
//   3 — athlete (≥7h/week high-intensity, needs BF%): BMR = 40.4 × FFM^0.932
//   2 — body comp (BF% on file):  BMR = 50.2×FFM^0.7 + 40.5×(FFM^0.7×FM^0.066) − age_term×age
//   1 — height/weight fallback:   BMR = 129.6×weight^0.55 + 0.011×height² − age_term×age − 213.8×sex
// Metabolic adaptation multipliers applied on top: deficit ×0.95,
// >10% below personal peak ×0.97, both ×0.92.
export function macroFactorTdee(params: {
  sex: "male" | "female";
  age: number;
  heightCm: number;
  weightKg: number;
  activityLevel: string;
  bodyFatPercent?: number | null;
  weeklyExerciseHours?: number | null;
  inDeficit?: boolean;
  peakWeightKg?: number;
}): number {
  const bf = params.bodyFatPercent;
  const hasBodyComp = bf != null && bf > 0 && bf < 100;
  const isAthlete = hasBodyComp && (params.weeklyExerciseHours ?? 0) >= 7;

  let bmr: number;
  if (isAthlete) {
    const ffm = params.weightKg * (1 - bf! / 100);
    bmr = 40.4 * Math.pow(ffm, 0.932);
  } else if (hasBodyComp) {
    const ffm = params.weightKg * (1 - bf! / 100);
    const fm = params.weightKg * (bf! / 100);
    const ageTerm = 1.1 * Math.min(params.age, 60) + 2.75 * Math.max(0, params.age - 60);
    bmr = 50.2 * Math.pow(ffm, 0.7) + 40.5 * (Math.pow(ffm, 0.7) * Math.pow(fm, 0.066)) - ageTerm * params.age;
  } else {
    const sexFactor = params.sex === "female" ? 1 : 0;
    const ageTerm = 1.96 * Math.min(params.age, 60) + 4.9 * Math.max(0, params.age - 60);
    bmr =
      129.6 * Math.pow(params.weightKg, 0.55) +
      0.011 * Math.pow(params.heightCm, 2) -
      ageTerm -
      213.8 * sexFactor;
  }

  let tdee = bmr * (ACTIVITY_MULTIPLIERS[params.activityLevel] ?? 1.375);

  const inDeficit = params.inDeficit ?? false;
  const farBelowPeak = params.peakWeightKg != null && params.weightKg < params.peakWeightKg * 0.9;
  if (inDeficit && farBelowPeak) tdee *= 0.92;
  else if (inDeficit) tdee *= 0.95;
  else if (farBelowPeak) tdee *= 0.97;

  return tdee;
}

// Kept as reference — macroFactorTdee() is the active fallback.
export function mifflinStJeorTdee(params: {
  sex: "male" | "female";
  age: number;
  heightCm: number;
  weightKg: number;
  activityLevel: string;
}): number {
  const bmr =
    params.sex === "male"
      ? 10 * params.weightKg + 6.25 * params.heightCm - 5 * params.age + 5
      : 10 * params.weightKg + 6.25 * params.heightCm - 5 * params.age - 161;
  return bmr * (ACTIVITY_MULTIPLIERS[params.activityLevel] ?? 1.375);
}

// Fraction of the window that must have a logged day before the estimate is
// trusted, not a hardcoded day count — so if `windowDays` (the `estimateAdaptiveTdee`
// param below) ever changes, the coverage bar scales with it automatically
// instead of silently becoming stricter or looser.
const MIN_CALORIE_COVERAGE = 0.5;

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// Drops the single highest and lowest reading before averaging — one bad
// (or great) day out of an 11-21 day window can otherwise swing the whole
// TDEE estimate on its own, even though it's exactly the kind of day-to-day
// noise the window is supposed to be smoothing over. Only kicks in with 5+
// values so a small sample doesn't lose a third or more of its data to a
// single trim — below that threshold this is just a plain mean, which is
// already what the outlier-sensitive case degrades to anyway. fluxKcal (the
// Flux Range band) is deliberately computed from the full, untrimmed values
// elsewhere in this file — trimming the point estimate but not the
// displayed variance keeps "how noisy was my real data" honest while making
// the anchor number itself less jumpy.
function trimmedMean(values: number[]): number {
  if (values.length < 5) return values.reduce((a, b) => a + b, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const trimmed = sorted.slice(1, -1);
  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

export interface AdaptiveTdeeEstimate {
  tdee: number;
  // Standard deviation of the window's own daily logged calories — since
  // impliedDeficit below is a single average over the whole window (the
  // trend-weight side is already smoothed), day-to-day movement in the TDEE
  // estimate is driven almost entirely by day-to-day movement in calories
  // eaten. This is what the Expenditure screen's "Flux Range" band is built
  // from: a real measure of how noisy *this person's own logged data* was
  // over the window that produced the estimate, not a fabricated confidence
  // interval — see CLAUDE.md for why a fabricated one was deliberately
  // avoided the first time this screen was built.
  fluxKcal: number;
}

// Backs out actual expenditure from the trend-weight change and average
// calories logged over a lookback window, instead of trusting a formula
// forever: TDEE = avg calories eaten + (implied deficit from weight lost),
// or - (implied surplus) if weight was gained. Returns null when there isn't
// enough overlapping weight+calorie data yet to trust the result, so the
// caller can fall back to the formula estimate. windowDays defaults to 21
// ("approximately three weeks") to mirror MacroFactor's own publicly
// documented window for its expenditure algorithm — long enough that a
// single noisy week doesn't dominate the estimate, matching the same
// "past three weeks" framing this app's frontend already uses independently
// for `weeklyTrendRateKgPerWeek` (lib/weightInsights.ts).
export function estimateAdaptiveTdee(
  weighIns: { date: string; weightKg: number }[],
  dailyCalories: { date: string; calories: number }[],
  windowDays = 21
): AdaptiveTdeeEstimate | null {
  const minCalorieDays = Math.ceil(windowDays * MIN_CALORIE_COVERAGE);
  if (weighIns.length < 2 || dailyCalories.length < minCalorieDays) return null;

  const trend = computeTrend(weighIns);
  const latestDate = trend[trend.length - 1].date;
  const windowStart = addDaysToDateString(latestDate, -windowDays);

  const trendInWindow = trend.filter((t) => t.date >= windowStart);
  if (trendInWindow.length < 2) return null;

  const firstPoint = trendInWindow[0];
  const lastPoint = trendInWindow[trendInWindow.length - 1];

  // Clipped to lastPoint.date, not just windowStart — dailyCalories is
  // fetched over its own wider trailing window upstream (see
  // gatherAdaptiveTdeeInputs), so without this upper bound, days logged
  // *after* the most recent weigh-in would get folded into the average
  // even though the weight side hasn't caught up to reflect them yet. Both
  // halves of the comparison now measure the identical span.
  const caloriesInWindow = dailyCalories.filter((d) => d.date >= windowStart && d.date <= lastPoint.date);
  if (caloriesInWindow.length < minCalorieDays) return null;

  const actualDays = Math.max(1, daysBetween(firstPoint.date, lastPoint.date));

  const dailyCalorieValues = caloriesInWindow.map((d) => d.calories);
  const avgCalories = trimmedMean(dailyCalorieValues);
  const weightChangeKg = lastPoint.trendKg - firstPoint.trendKg;
  const impliedDeficit = (weightChangeKg * KCAL_PER_KG) / actualDays;

  return {
    tdee: avgCalories - impliedDeficit,
    fluxKcal: stddev(dailyCalorieValues),
  };
}

export interface MacroTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

// Split: protein anchored to trend bodyweight (g/kg), fat as a share of total
// calories, carbs always absorb whatever's left. proteinPerKg/fatPercent are
// user-adjustable (profiles.proteinPerKg/fatPercent); 2.0 g/kg and 25% fat
// are just the defaults a new profile starts with, not hardcoded truths.
// carbsKcal is clamped at 0 rather than going negative — an aggressive
// protein+fat combination on a low-calorie cut can otherwise leave nothing
// for carbs, which is a valid (if extreme) outcome, not a bug to hide.
export function computeMacroTargets(
  targetCalories: number,
  trendWeightKg: number,
  proteinPerKg: number,
  fatPercent: number
): MacroTargets {
  const proteinG = proteinPerKg * trendWeightKg;
  const proteinKcal = proteinG * 4;
  const fatKcal = fatPercent * targetCalories;
  const fatG = fatKcal / 9;
  const carbsKcal = Math.max(0, targetCalories - proteinKcal - fatKcal);
  const carbsG = carbsKcal / 4;
  return {
    calories: Math.round(targetCalories),
    proteinG: Math.round(proteinG * 10) / 10,
    carbsG: Math.round(carbsG * 10) / 10,
    fatG: Math.round(fatG * 10) / 10,
  };
}
