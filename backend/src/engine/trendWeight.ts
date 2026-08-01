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
  // null on an implied (interpolated-only) day from computeDenseTrend — see
  // its own doc comment. Always a real number from computeTrend, which only
  // ever emits actual weigh-in days.
  weightKg: number | null;
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

// Exponentially weighted moving average with gap-filling: a missed run of
// days between two real weigh-ins is bridged by linearly interpolating the
// raw weight across the gap (MacroFactor's own docs describe exactly this —
// e.g. 170lbs one week and 169lbs the next is treated as a steady 1/7lb/day
// decline, not one lump-sum jump on the last day) and stepping the standard
// daily EWMA once per implied day rather than folding the whole gap into a
// single widened-alpha jump. The two are NOT equivalent: a one-step jump
// implicitly assumes the raw weight was already at the new reading for the
// entire gap, which overshoots the interpolated version (verified by hand:
// an 80kg trend jumping to an 82kg reading over a 10-day gap lands at
// ~81.30kg with a single widened-alpha jump vs. ~80.83kg stepping day-by-day
// over the interpolated ramp — a real, non-trivial divergence, not a
// rounding difference). Day-by-day stepping is the more faithful
// reconstruction of "what the trend would have read had you weighed in
// every day of the gap."
// Same EWMA/gap-interpolation as computeTrend above, but emits a row for
// every implied calendar day between weigh-ins, not just the weigh-in days
// themselves — the daily step already happens internally either way (see the
// doc comment above), this just exposes it instead of discarding it. Powers
// the Weight Trend chart's dense per-day line, matching MacroFactor's own
// "trend recalculated daily" look, without fabricating a *scale* reading:
// `weightKg` stays `null` on every day that isn't an actual weigh-in, so a
// consumer plotting raw scale weight (as opposed to the derived trend) can
// filter to real readings only and never render an invented data point. Only
// this dense route is display-facing — everything that measures TDEE,
// programs, or "current trend weight" keeps using computeTrend below, which
// is defined in terms of this function so the two can never drift apart.
export function computeDenseTrend(weighIns: WeighIn[]): TrendPoint[] {
  const sorted = [...weighIns].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const points: TrendPoint[] = [];
  let trend: number | null = null;
  let prevDate: string | null = null;
  let prevWeight: number | null = null;

  for (const w of sorted) {
    if (trend === null || prevDate === null || prevWeight === null) {
      trend = w.weightKg;
      points.push({ date: w.date, weightKg: w.weightKg, trendKg: Math.round(trend * 100) / 100 });
    } else {
      const gap = Math.max(1, daysBetween(prevDate, w.date));
      for (let day = 1; day <= gap; day++) {
        const interpolatedWeight = prevWeight + ((w.weightKg - prevWeight) * day) / gap;
        trend = ALPHA * interpolatedWeight + (1 - ALPHA) * trend;
        const isRealDay = day === gap;
        points.push({
          date: addDaysToDateString(prevDate, day),
          weightKg: isRealDay ? w.weightKg : null,
          trendKg: Math.round(trend * 100) / 100,
        });
      }
    }
    prevDate = w.date;
    prevWeight = w.weightKg;
  }
  return points;
}

export function computeTrend(weighIns: WeighIn[]): TrendPoint[] {
  return computeDenseTrend(weighIns).filter((p) => p.weightKg !== null);
}
