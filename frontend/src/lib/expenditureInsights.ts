import type { DailyExpenditurePoint } from "../api/coach";
import { addDays, daysBetween, localDateString } from "./date";

export interface ExpenditureSamplePoint {
  date: string;
  tdee: number;
}

// The daily backfill (GET /api/coach/expenditure-daily) only has a row on a
// day the adaptive engine could produce a fresh estimate — everywhere else
// is a gap, held forward at whatever the last real estimate was (this is the
// "Holding" state MacroFactor surfaces explicitly, and TdeeChart's own
// CheckinDot-replacement dot styling shows the same distinction on the
// graph). Sampling one point per calendar day this way turns the sparse
// backfill into a continuous series so range averages/deltas are correctly
// time-weighted rather than treating every real estimate as equally spaced.
// Days before the first real estimate are skipped (there's no value to
// hold), not zero-filled.
export function sampleDailyExpenditure(
  dailyAsc: DailyExpenditurePoint[],
  startDate: string,
  endDate: string
): ExpenditureSamplePoint[] {
  if (dailyAsc.length === 0) return [];
  const firstRealDate = dailyAsc[0].date;
  const from = startDate < firstRealDate ? firstRealDate : startDate;
  if (from > endDate) return [];

  const points: ExpenditureSamplePoint[] = [];
  let holdIdx = -1;
  const totalDays = daysBetween(from, endDate);
  for (let i = 0; i <= totalDays; i++) {
    const date = addDays(from, i);
    while (holdIdx + 1 < dailyAsc.length && dailyAsc[holdIdx + 1].date <= date) holdIdx++;
    if (holdIdx >= 0) points.push({ date, tdee: dailyAsc[holdIdx].tdee });
  }
  return points;
}

export interface ExpenditureChangeStat {
  windowDays: number;
  deltaKcal: number | null;
  series: number[];
}

// Mirrors weightInsights.ts's trendChangeOverDays — same trailing-window
// shape, applied to the daily-sampled held-forward series instead of a
// smoothed trend, since expenditure has no separate "trend vs. raw"
// distinction the way weight does.
export function expenditureChangeOverDays(dailyAsc: DailyExpenditurePoint[], windowDays: number): ExpenditureChangeStat {
  if (dailyAsc.length === 0) return { windowDays, deltaKcal: null, series: [] };
  const today = localDateString();
  const latestSampleDate = today < dailyAsc[dailyAsc.length - 1].date ? dailyAsc[dailyAsc.length - 1].date : today;
  const cutoffDate = addDays(latestSampleDate, -windowDays);
  const windowPoints = sampleDailyExpenditure(dailyAsc, cutoffDate, latestSampleDate);
  if (windowPoints.length < 2) {
    return { windowDays, deltaKcal: null, series: windowPoints.map((p) => p.tdee) };
  }
  const start = windowPoints[0];
  const latest = windowPoints[windowPoints.length - 1];
  return {
    windowDays,
    deltaKcal: Math.round(latest.tdee - start.tdee),
    series: windowPoints.map((p) => p.tdee),
  };
}
