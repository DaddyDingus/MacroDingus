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
// fetch. Multi-day actuals and targets use only days the user actually
// logged, so a skipped day means "unknown" rather than a fabricated zero-
// intake day. The single-day view still shows its target before logging.
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
  let actualCount = 0;
  let targetSum = 0;
  let targetCount = 0;
  for (const d of dates) {
    const row = history.get(d);
    if (row?.logged && !row.incomplete) {
      actualSum += row[metricKey];
      actualCount++;
    }
    const t = targetsForDate(programs, d);
    if (t && (days === 1 || (row?.logged && !row.incomplete))) {
      targetSum += t[targetKey];
      targetCount++;
    }
  }
  const actual = actualCount > 0 ? actualSum / actualCount : 0;
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
