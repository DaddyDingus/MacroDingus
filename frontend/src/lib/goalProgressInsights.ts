import { addDays, daysBetween } from "./date";

export interface WeeklyDistancePoint {
  label: string;
  distanceKg: number;
  direction: "away" | "towards" | "status";
}

// Looks up the last known value at or before `date` — used to resolve "what
// was the weight at the end of week N" from a plain ascending list of
// weigh-ins or trend points, without needing a reading on that exact day.
function valueAtOrBefore(points: { date: string; valueKg: number }[], date: string): number | null {
  let result: number | null = null;
  for (const p of points) {
    if (p.date > date) break;
    result = p.valueKg;
  }
  return result;
}

// One bar per completed 7-day period since the goal started, plus a final
// "Status" bar for right now — mirrors MacroFactor's own waterfall: the
// distance-to-goal at the end of each week, colored by whether that week
// moved the distance closer ("towards") or further ("away") than the week
// before it. Week 0 (the starting point) has nothing to compare against,
// so it's always "away"-colored — a neutral starting marker, not a
// judgment, same as MacroFactor's own lighter first bar. The final "Status"
// bar is today's actual distance rather than a completed week, so it's
// rendered as its own neutral direction rather than folded into the
// away/towards coloring.
export function computeGoalWaterfall(
  points: { date: string; valueKg: number }[],
  goalStartDate: string,
  goalWeightKg: number,
  today: string
): WeeklyDistancePoint[] {
  if (points.length === 0) return [];

  const totalDays = Math.max(0, daysBetween(goalStartDate, today));
  const totalWeeks = Math.floor(totalDays / 7);

  const buckets: WeeklyDistancePoint[] = [];
  let prevDistance: number | null = null;
  for (let w = 0; w <= totalWeeks; w++) {
    const weekEndDate = addDays(goalStartDate, w * 7);
    const value = valueAtOrBefore(points, weekEndDate) ?? valueAtOrBefore(points, goalStartDate);
    if (value === null) continue;
    const distance = Math.abs(goalWeightKg - value);
    const direction: WeeklyDistancePoint["direction"] =
      prevDistance === null ? "away" : distance <= prevDistance ? "towards" : "away";
    buckets.push({ label: `Week ${w}`, distanceKg: distance, direction });
    prevDistance = distance;
  }

  const latestValue = valueAtOrBefore(points, today);
  if (latestValue !== null) {
    buckets.push({ label: "Status", distanceKg: Math.abs(goalWeightKg - latestValue), direction: "status" });
  }

  return buckets;
}

// "Optimistic" because it assumes the profile's own *intended* rate
// (profile.targetRateKgPerWeek) is hit and sustained exactly — not a
// projection from actual recent behavior, which is what the word means in
// MacroFactor's own copy ("if you achieve and sustain your intended rate").
// Null when the goal is to maintain (rate 0, no ETA is meaningful).
export function computeOptimisticEtaDate(distanceKg: number, targetRateKgPerWeek: number, today: string): string | null {
  if (targetRateKgPerWeek === 0) return null;
  const daysNeeded = distanceKg <= 0 ? 0 : Math.ceil((distanceKg / Math.abs(targetRateKgPerWeek)) * 7);
  return addDays(today, daysNeeded);
}
