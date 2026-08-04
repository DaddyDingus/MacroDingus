import { eq, and, gte, isNotNull, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { weights, logs, foods } from "../db/schema.js";
import { scaleNutrition } from "../engine/nutrition.js";
import { computeTrend, addDaysToDateString } from "../engine/trendWeight.js";
import { householdDateString } from "../lib/householdDate.js";

// Shared by coach.ts's performCheckin() and programs.ts's program-generation
// routes — both need "the current trend weight" for a user.
export async function currentTrendKg(userId: string): Promise<number | null> {
  const weighIns = await db.select().from(weights).where(eq(weights.userId, userId)).orderBy(weights.date);
  if (weighIns.length === 0) return null;
  const trend = computeTrend(weighIns.map((w) => ({ date: w.date, weightKg: w.weightKg })));
  return trend[trend.length - 1].trendKg;
}

// Most recent non-null body fat % on file — not a trend/EWMA like weight,
// since entries are occasional (Navy tape/calipers/BIA), not daily. Carries
// forward as-is until the next reading.
export async function mostRecentBodyFatPercent(userId: string): Promise<number | null> {
  const [row] = await db
    .select()
    .from(weights)
    .where(and(eq(weights.userId, userId), isNotNull(weights.bodyFatPercent)))
    .orderBy(desc(weights.date))
    .limit(1);
  return row?.bodyFatPercent ?? null;
}

// programs.shiftedHighDays storage format — shared by programs.ts (writes on
// create) and coach.ts's performCheckin() (reads to preserve the choice
// across a check-in's program regeneration).
export function shiftedHighDaysJson(days: number[] | undefined): string | null {
  return days && days.length > 0 ? JSON.stringify(days) : null;
}

export function parseShiftedHighDays(json: string | null): number[] | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// Every program row crossing the API boundary gets shiftedHighDays parsed
// from its raw JSON-string column into a real array (or null) — the
// frontend works with number[] | null, not a string it'd have to parse
// itself. Used by both programs.ts's routes and coach.ts's /coach/status.
export function serializeProgram<T extends { shiftedHighDays: string | null }>(
  p: T
): Omit<T, "shiftedHighDays"> & { shiftedHighDays: number[] | null } {
  return { ...p, shiftedHighDays: parseShiftedHighDays(p.shiftedHighDays) ?? null };
}

const CALORIE_LOOKBACK_DAYS = 28; // window for adaptive TDEE (needs 21 days of overlap; pad a bit for logging gaps)

// The raw weigh-in + windowed daily-calorie inputs estimateAdaptiveTdee()
// needs — shared by performCheckin() (an actual check-in) and the New
// Program wizard's Coached generation (which estimates TDEE the exact same
// way, just doesn't persist a checkins row for it).
export async function gatherAdaptiveTdeeInputs(userId: string) {
  const weighIns = await db.select().from(weights).where(eq(weights.userId, userId)).orderBy(weights.date);

  const today = householdDateString();
  const cutoff = addDaysToDateString(today, -CALORIE_LOOKBACK_DAYS);
  const logRows = await db
    .select({ log: logs, food: foods })
    .from(logs)
    .innerJoin(foods, eq(logs.foodId, foods.id))
    .where(and(eq(logs.userId, userId), gte(logs.date, cutoff)));

  const caloriesByDate = new Map<string, number>();
  for (const { log, food } of logRows) {
    const calories = scaleNutrition(food, log.quantityGrams).calories;
    caloriesByDate.set(log.date, (caloriesByDate.get(log.date) ?? 0) + calories);
  }
  const dailyCalories = [...caloriesByDate.entries()].map(([date, calories]) => ({ date, calories }));

  return {
    weighIns: weighIns.map((w) => ({ date: w.date, weightKg: w.weightKg })),
    dailyCalories,
  };
}

// Same shape as gatherAdaptiveTdeeInputs, but for GET /api/coach/expenditure-daily's
// day-by-day backfill instead of a single "as of today" estimate: dailyCalories
// needs to reach back CALORIE_LOOKBACK_DAYS before the *start* of the requested
// window (not just before today), so estimateAdaptiveTdee's trailing window is
// fully populated even on the very first requested day.
export async function gatherDailyTdeeSeriesInputs(userId: string, days: number) {
  const weighIns = await db.select().from(weights).where(eq(weights.userId, userId)).orderBy(weights.date);

  const today = householdDateString();
  const cutoff = addDaysToDateString(today, -(days + CALORIE_LOOKBACK_DAYS));
  const logRows = await db
    .select({ log: logs, food: foods })
    .from(logs)
    .innerJoin(foods, eq(logs.foodId, foods.id))
    .where(and(eq(logs.userId, userId), gte(logs.date, cutoff)));

  const caloriesByDate = new Map<string, number>();
  for (const { log, food } of logRows) {
    const calories = scaleNutrition(food, log.quantityGrams).calories;
    caloriesByDate.set(log.date, (caloriesByDate.get(log.date) ?? 0) + calories);
  }
  const dailyCalories = [...caloriesByDate.entries()].map(([date, calories]) => ({ date, calories }));

  return {
    weighIns: weighIns.map((w) => ({ date: w.date, weightKg: w.weightKg })),
    dailyCalories,
  };
}
