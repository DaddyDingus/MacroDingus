import type { DayHistory } from "../api/logs";
import type { Program } from "../api/programs";
import { addDays } from "./date";
import { targetsForDate, type DayTargets } from "./programTargets";

export interface WindowStat {
  actual: number;
  target: number | null;
  pct: number | null;
}

function datesEnding(date: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(date, -(days - 1 - i)));
}

// Average-per-day actual vs. average-per-day target for a fixed window
// ending at `date` — deliberately averages rather than sums (see the day-
// detail screens' own reasoning: matches how every other multi-day stat in
// this app is already framed, e.g. WeightDetailScreen's Average/Difference).
// `history` should already be the full dense history (useLogsHistory), not
// pre-sliced — this does its own windowing so day/week/month can share one
// fetch. Target is averaged only over days that actually had an active
// program, so a gap in program coverage doesn't silently drag the target
// average toward zero.
function windowStat(
  history: Map<string, DayHistory>,
  programs: Program[],
  date: string,
  days: number,
  metricKey: "calories" | "protein" | "carbs" | "fat",
  targetKey: keyof DayTargets
): WindowStat {
  const dates = datesEnding(date, days);
  let actualSum = 0;
  let targetSum = 0;
  let targetCount = 0;
  for (const d of dates) {
    const row = history.get(d);
    actualSum += row ? row[metricKey] : 0;
    const t = targetsForDate(programs, d);
    if (t) {
      targetSum += t[targetKey];
      targetCount++;
    }
  }
  const actual = actualSum / dates.length;
  const target = targetCount > 0 ? targetSum / targetCount : null;
  const pct = target ? Math.round((actual / target) * 100) : null;
  return { actual, target, pct };
}

export function computeNutrientWindowStats(
  history: DayHistory[],
  programs: Program[],
  date: string,
  metricKey: "calories" | "protein" | "carbs" | "fat",
  targetKey: keyof DayTargets
): { day: WindowStat; week: WindowStat; month: WindowStat } {
  const byDate = new Map(history.map((d) => [d.date, d]));
  return {
    day: windowStat(byDate, programs, date, 1, metricKey, targetKey),
    week: windowStat(byDate, programs, date, 7, metricKey, targetKey),
    month: windowStat(byDate, programs, date, 30, metricKey, targetKey),
  };
}
