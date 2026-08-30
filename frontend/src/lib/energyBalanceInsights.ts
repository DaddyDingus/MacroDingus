import { addDays } from "./date";
import type { ChangeDirection } from "./changeIndicator";

export type EnergyBalanceTab = "expenditure" | "targets";

export interface DailyBalancePoint {
  date: string;
  calories: number;
  compare: number;
  balance: number; // calories - compare: negative = deficit/below target
}

// Pairs each day's logged calories with whatever the caller resolves as
// that day's "compare" value — expenditure tab passes a checkin-TDEE
// lookup, targets tab passes a program-target lookup (targetsForDate);
// these come from two different sources now (checkins is TDEE-only,
// program_days is targets-only), so this takes a resolver function instead
// of indexing a shared object shape. Days the resolver can't answer for are
// dropped rather than shown with a fabricated compare value — same "missing
// means unreported" rule the rest of this app follows.
export function buildDailyBalance(
  history: { date: string; calories: number; logged: boolean; incomplete: boolean }[],
  compareValueForDate: (date: string) => number | null,
  inProgressDate?: string
): DailyBalancePoint[] {
  const points: DailyBalancePoint[] = [];
  for (const d of history) {
    // A dense history gap means "not logged", not "ate nothing". Including
    // it would fabricate a full-day deficit equal to expenditure/target.
    // Today's intake is a running total, not a completed daily value, so it
    // cannot contribute to a chart or average of daily energy balance.
    if (!d.logged || d.incomplete || d.date === inProgressDate) continue;
    const compare = compareValueForDate(d.date);
    if (compare === null) continue;
    points.push({ date: d.date, calories: d.calories, compare, balance: d.calories - compare });
  }
  return points;
}

// Trailing-window average daily balance, anchored to the latest point in
// `points` (the Energy Balance screen excludes today's partial entry, so this
// is normally the most recent completed day). Used both for the range-scoped summary stat (windowDays
// = whatever the range toggle picked) and the fixed 3/7/14/30/90-day
// Insights card — same math, different window.
export function averageBalanceOverDays(points: DailyBalancePoint[], windowDays: number): number | null {
  if (points.length === 0) return null;
  const latestDate = points[points.length - 1].date;
  const cutoff = addDays(latestDate, -(windowDays - 1));
  // Real history has to actually reach back to the window's start date, not
  // just contain some points — otherwise every window longer than the
  // available history clamps to the same full array and reports an
  // identical average instead of "not enough data yet" (same fix as
  // trendChangeOverDays/expenditureChangeOverDays).
  if (points[0].date > cutoff) return null;
  const windowPoints = points.filter((p) => p.date >= cutoff);
  if (windowPoints.length === 0) return null;
  return windowPoints.reduce((sum, p) => sum + p.balance, 0) / windowPoints.length;
}

// Maps the generic increase/decrease/none classification onto the label the
// active tab actually uses — a "balance" is a sign, not a trend, but
// changeDirection's epsilon-guarded sign check is exactly what's needed
// here too (see its own doc comment for why epsilon is required, not
// defaulted).
export function balanceLabel(direction: ChangeDirection, tab: EnergyBalanceTab): string {
  if (tab === "expenditure") {
    if (direction === "increase") return "Surplus";
    if (direction === "decrease") return "Deficit";
    return "Balanced";
  }
  if (direction === "increase") return "Above Target";
  if (direction === "decrease") return "Below Target";
  return "On Target";
}
