import { computeTrend, daysBetween, addDaysToDateString, KCAL_PER_KG } from "./trendWeight.js";

export const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

// Mifflin-St Jeor — the initial TDEE estimate before there's enough logging
// history to derive one from actual data. Only used until estimateAdaptiveTdee
// has enough to work with, and again if a check-in is done with too sparse a
// window (e.g. after a long break from logging).
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

const MIN_CALORIE_DAYS = 7;

// Backs out actual expenditure from the trend-weight change and average
// calories logged over a lookback window, instead of trusting a formula
// forever: TDEE = avg calories eaten + (implied deficit from weight lost),
// or - (implied surplus) if weight was gained. Returns null when there isn't
// enough overlapping weight+calorie data yet to trust the result, so the
// caller can fall back to the formula estimate.
export function estimateAdaptiveTdee(
  weighIns: { date: string; weightKg: number }[],
  dailyCalories: { date: string; calories: number }[],
  windowDays = 14
): number | null {
  if (weighIns.length < 2 || dailyCalories.length < MIN_CALORIE_DAYS) return null;

  const trend = computeTrend(weighIns);
  const latestDate = trend[trend.length - 1].date;
  const windowStart = addDaysToDateString(latestDate, -windowDays);

  const trendInWindow = trend.filter((t) => t.date >= windowStart);
  const caloriesInWindow = dailyCalories.filter((d) => d.date >= windowStart);
  if (trendInWindow.length < 2 || caloriesInWindow.length < MIN_CALORIE_DAYS) return null;

  const firstPoint = trendInWindow[0];
  const lastPoint = trendInWindow[trendInWindow.length - 1];
  const actualDays = Math.max(1, daysBetween(firstPoint.date, lastPoint.date));

  const avgCalories = caloriesInWindow.reduce((sum, d) => sum + d.calories, 0) / caloriesInWindow.length;
  const weightChangeKg = lastPoint.trendKg - firstPoint.trendKg;
  const impliedDeficit = (weightChangeKg * KCAL_PER_KG) / actualDays;

  return avgCalories - impliedDeficit;
}

export interface MacroTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

// Default split: protein anchored to bodyweight (2.0 g/kg — comfortably
// covers muscle-preservation needs across cut/maintain/bulk without needing
// a training-experience input), fat at 25% of calories (adequate for
// hormone function), carbs absorb the remainder. Not user-adjustable yet —
// a reasonable evidence-based default, not a claim it's optimal for everyone.
export function computeMacroTargets(targetCalories: number, trendWeightKg: number): MacroTargets {
  const proteinG = 2.0 * trendWeightKg;
  const proteinKcal = proteinG * 4;
  const fatKcal = 0.25 * targetCalories;
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
