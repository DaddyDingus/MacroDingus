// Smoothing factor for the EWMA — roughly a 10-day effective half-life,
// gentle enough to absorb typical day-to-day water-weight noise (1-2kg)
// without lagging so far behind that a real trend takes weeks to show up.
const ALPHA = 0.1;

// Approximate energy density of a kilogram of bodyweight change. True value
// varies with body composition (fat vs. lean tissue), but ~7700 kcal/kg is
// the standard approximation used by most adaptive-TDEE tools.
export const KCAL_PER_KG = 7700;

export interface WeighIn {
  date: string; // YYYY-MM-DD
  weightKg: number;
}

export interface TrendPoint {
  date: string;
  weightKg: number;
  trendKg: number;
}

// Pure UTC date arithmetic throughout — avoids the local-timezone ambiguity
// of Date's setDate()/getDate(), which would silently shift results by a day
// depending on the server's timezone. Every date in this app is a bare
// YYYY-MM-DD string with no timezone of its own, so UTC is just a fixed,
// consistent choice, not a claim about where the reading actually happened.
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / msPerDay);
}

export function addDaysToDateString(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// Exponentially weighted moving average with a time-gap correction: a longer
// gap since the last weigh-in pulls the trend further toward the new reading
// than a 1-day gap would, as if daily readings had continued at the same
// implicit rate — without this, missing a week would barely move the trend
// at all, which doesn't match what actually happened to the person's weight.
export function computeTrend(weighIns: WeighIn[]): TrendPoint[] {
  const sorted = [...weighIns].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const points: TrendPoint[] = [];
  let trend: number | null = null;
  let prevDate: string | null = null;

  for (const w of sorted) {
    if (trend === null || prevDate === null) {
      trend = w.weightKg;
    } else {
      const gap = Math.max(1, daysBetween(prevDate, w.date));
      const effectiveAlpha = 1 - Math.pow(1 - ALPHA, gap);
      trend = effectiveAlpha * w.weightKg + (1 - effectiveAlpha) * trend;
    }
    prevDate = w.date;
    points.push({ date: w.date, weightKg: w.weightKg, trendKg: Math.round(trend * 100) / 100 });
  }
  return points;
}
