import { addDays, daysBetween } from "./date";

export interface GoalWeightPoint {
  date: string;
  weightKg: number;
  distanceKg: number;
  kind: "start" | "checkpoint" | "current";
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

// A small chronological series of actual-weight checkpoints. The goal's
// saved start-weight is always the first point; each full week becomes an
// intermediate point and the most recent real value is the final point. The
// accompanying distance is retained for the tooltip, while the chart itself
// can show the more recognisable scale/trend weight values.
export function computeGoalWeightSeries(
  points: { date: string; valueKg: number }[],
  goalStartDate: string,
  goalStartWeightKg: number,
  goalWeightKg: number,
  today: string
): GoalWeightPoint[] {
  // A weigh-in from before this goal must not overwrite the goal's own
  // start-weight snapshot. That snapshot defines this particular journey.
  const goalPoints = points.filter((point) => point.date >= goalStartDate && point.date <= today);
  const latestPoint = goalPoints[goalPoints.length - 1];
  const currentDate = latestPoint?.date ?? goalStartDate;
  const currentWeightKg = latestPoint?.valueKg ?? goalStartWeightKg;
  const totalWeeks = Math.floor(Math.max(0, daysBetween(goalStartDate, currentDate)) / 7);

  const series: GoalWeightPoint[] = [
    {
      date: goalStartDate,
      weightKg: goalStartWeightKg,
      distanceKg: Math.abs(goalWeightKg - goalStartWeightKg),
      kind: "start",
    },
  ];

  for (let w = 1; w <= totalWeeks; w++) {
    const weekEndDate = addDays(goalStartDate, w * 7);
    // The final point below owns the current date, including when it happens
    // to fall exactly on a weekly checkpoint; don't render it twice.
    if (weekEndDate >= currentDate) break;
    const value = valueAtOrBefore(goalPoints, weekEndDate) ?? goalStartWeightKg;
    series.push({ date: weekEndDate, weightKg: value, distanceKg: Math.abs(goalWeightKg - value), kind: "checkpoint" });
  }

  if (currentDate !== goalStartDate) {
    series.push({
      date: currentDate,
      weightKg: currentWeightKg,
      distanceKg: Math.abs(goalWeightKg - currentWeightKg),
      kind: "current",
    });
  }

  return series;
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
