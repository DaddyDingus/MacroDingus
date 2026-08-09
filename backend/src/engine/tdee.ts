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
// Source: macrofactor.com/macrofactors-bmr/
// MacroFactor's three published BMR formulas (macrofactor.com/macrofactors-bmr/,
// shipped in app v2.9.8, August 2024). Formula selected by available data:
//   3 — athlete (≥7h/week high-intensity, needs BF%): BMR = 40.4 × FFM^0.932
//   2 — body comp (BF% on file):  BMR = 50.2×FFM^0.7 + 40.5×(FFM^0.7×FM^0.066) − piecewise age term
//   1 — height/weight fallback:   BMR = 129.6×weight^0.55 + 0.011×height² − age_term×age − 213.8×sex
// Metabolic adaptation multipliers applied on top: deficit ×0.95,
// >10% below personal peak ×0.97, both ×0.92.
//
// HARD_TRAINING_MET below is this app's own addition, NOT part of
// MacroFactor's published methodology — flagged explicitly so it's never
// mistaken for something sourced the way the BMR formulas above are.
// weeklyExerciseHours (BasicProfileForm's "High-intensity exercise" field,
// deliberately kept separate from activityLevel — see that form's own "don't
// count workouts here" copy) previously only affected this function via the
// isAthlete branch below, which requires a body-fat % on file too — anyone
// without one had their reported training hours silently discarded no matter
// how high. Added as a direct EAT (exercise activity thermogenesis) term
// instead: MET × bodyweight × hours is the standard Compendium of Physical
// Activities method for converting a workout into kcal (1 MET = 1 kcal/kg/
// hour); 7.0 sits mid-range across the field's own named examples (general
// weight training ~6 METs, running ~8-10, HIIT ~8) since the field collects
// hours only, not a specific modality. Skipped for isAthlete — its FFM^0.932
// equation already represents a ≥7h/week-trained athlete's elevated energy
// needs as a whole, so adding this on top would double-count the same
// training volume. Added after the metabolic-adaptation multipliers, not
// before: those model suppressed NEAT/BMR during a diet, not the mechanical
// cost of a given workout, which doesn't itself shrink from being in a
// deficit.
const HARD_TRAINING_MET = 7;

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
    bmr = 50.2 * Math.pow(ffm, 0.7) + 40.5 * (Math.pow(ffm, 0.7) * Math.pow(fm, 0.066)) - ageTerm;
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

  if (!isAthlete && params.weeklyExerciseHours) {
    tdee += (params.weightKg * HARD_TRAINING_MET * params.weeklyExerciseHours) / 7;
  }

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

export interface AdaptiveTdeeCoverage {
  ready: boolean;
  nutritionDays: number;
  nutritionDaysRequired: number;
  weighIns: number;
  weighInsRequired: number;
  weightSpanDays: number;
  latestWeightDate: string | null;
}

// Explains the exact eligibility gates estimateAdaptiveTdee applies. Kept
// beside the estimator so UI copy cannot drift from the calculation.
export function adaptiveTdeeCoverage(
  weighIns: { date: string; weightKg: number }[],
  dailyCalories: { date: string; calories: number }[],
  windowDays = 21
): AdaptiveTdeeCoverage {
  const nutritionDaysRequired = Math.ceil(windowDays * MIN_CALORIE_COVERAGE);
  const weighInsRequired = 2;
  if (weighIns.length === 0) {
    return { ready: false, nutritionDays: 0, nutritionDaysRequired, weighIns: 0, weighInsRequired, weightSpanDays: 0, latestWeightDate: null };
  }
  const trend = computeTrend(weighIns);
  const latest = trend[trend.length - 1];
  const windowStart = addDaysToDateString(latest.date, -windowDays);
  const trendInWindow = trend.filter((point) => point.date >= windowStart);
  const first = trendInWindow[0];
  const nutritionDays = first
    ? dailyCalories.filter((day) => day.date >= first.date && day.date <= latest.date).length
    : 0;
  const weightSpanDays = first ? Math.max(0, daysBetween(first.date, latest.date)) : 0;
  return {
    ready: trendInWindow.length >= weighInsRequired && nutritionDays >= nutritionDaysRequired,
    nutritionDays,
    nutritionDaysRequired,
    weighIns: trendInWindow.length,
    weighInsRequired,
    weightSpanDays,
    latestWeightDate: latest.date,
  };
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

  // Clip to the actual first/last trend points, not just the nominal 21-day
  // boundary. When weight history starts partway through that window,
  // including older calorie days compares intake from one span with weight
  // change from a shorter one. Both halves must measure the identical span.
  const caloriesInWindow = dailyCalories.filter((d) => d.date >= firstPoint.date && d.date <= lastPoint.date);
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
// Protein is preserved first, fat gets up to its requested share, and carbs
// absorb the remainder. In pathological low-calorie/custom-protein cases,
// protein is capped at the full calorie budget; this keeps the macro-derived
// calories internally consistent instead of returning grams whose calories
// exceed the headline target.
export function computeMacroTargets(
  targetCalories: number,
  trendWeightKg: number,
  proteinPerKg: number,
  fatPercent: number
): MacroTargets {
  const safeCalories = Math.max(0, targetCalories);
  const proteinG = Math.min(proteinPerKg * trendWeightKg, safeCalories / 4);
  const proteinKcal = proteinG * 4;
  const fatKcal = Math.min(fatPercent * safeCalories, Math.max(0, safeCalories - proteinKcal));
  const fatG = fatKcal / 9;
  const carbsKcal = Math.max(0, safeCalories - proteinKcal - fatKcal);
  const carbsG = carbsKcal / 4;
  return {
    calories: Math.round(safeCalories),
    proteinG: Math.round(proteinG * 10) / 10,
    carbsG: Math.round(carbsG * 10) / 10,
    fatG: Math.round(fatG * 10) / 10,
  };
}
