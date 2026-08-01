import type { TrendPoint } from "../api/weights";
import { addDays, daysBetween } from "./date";

// Mirrors backend/src/engine/trendWeight.ts's KCAL_PER_KG — the standard
// ~7700 kcal/kg approximation for a kilogram of bodyweight change, used here
// to turn a trend-weight rate into an implied daily energy surplus/deficit
// entirely client-side (no extra round trip; the trend points are already
// fetched for the chart).
export const KCAL_PER_KG = 7700;

export interface WeightChangeStat {
  windowDays: number;
  deltaKg: number | null;
  series: number[];
}

// Change in trend weight over a trailing window ending at the latest point in
// `points`. `points` should already span at least `windowDays` back for a
// real answer — if history doesn't go back that far yet, or there's fewer
// than two points in the window, deltaKg comes back null rather than a
// misleadingly small number computed from a too-short window.
export function trendChangeOverDays(points: TrendPoint[], windowDays: number): WeightChangeStat {
  if (points.length === 0) return { windowDays, deltaKg: null, series: [] };
  const latest = points[points.length - 1];
  const cutoffDate = addDays(latest.date, -windowDays);
  const windowPoints = points.filter((p) => p.date >= cutoffDate);
  if (windowPoints.length < 2) {
    return { windowDays, deltaKg: null, series: windowPoints.map((p) => p.trendKg) };
  }
  const start = windowPoints[0];
  return {
    windowDays,
    deltaKg: Math.round((latest.trendKg - start.trendKg) * 100) / 100,
    series: windowPoints.map((p) => p.trendKg),
  };
}

// Trailing rate of trend-weight change, expressed per week (matching how
// most coaching guidance — and MacroFactor — frames it) rather than per day.
// windowDays defaults to 21 ("the past three weeks"): long enough to smooth
// past normal week-to-week noise, short enough to stay a genuinely recent
// rate rather than a stale multi-month average.
export function weeklyTrendRateKgPerWeek(points: TrendPoint[], windowDays = 21): number | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  const cutoffDate = addDays(latest.date, -windowDays);
  const windowPoints = points.filter((p) => p.date >= cutoffDate);
  if (windowPoints.length < 2) return null;
  const start = windowPoints[0];
  const actualDays = Math.max(1, daysBetween(start.date, latest.date));
  return ((latest.trendKg - start.trendKg) / actualDays) * 7;
}

export function projectTrendKg(latestKg: number, weeklyRateKg: number, daysAhead: number): number {
  return latestKg + (weeklyRateKg / 7) * daysAhead;
}
