import { useMemo, useState } from "react";
import { useWeightTrend, useWeights, useDeleteWeight } from "../api/weights";
import { formatDayLabel, dayIndex, addDays, localDateString } from "../lib/date";
import { useWeightUnit, kgToUnit } from "../lib/weightUnit";
import { trendChangeOverDays, weeklyTrendRateKgPerWeek, projectTrendKg, KCAL_PER_KG } from "../lib/weightInsights";
import { changeDirection, changeDirectionLabel } from "../lib/changeIndicator";
import { useChartGesture } from "../hooks/useChartGesture";
import { RANGE_PRESETS } from "../lib/chartLayout";
import WeightChart, { WeightChartLegend } from "../components/WeightChart";
import ChartCard from "../components/ChartCard";
import MiniLineSpark from "../components/MiniLineSpark";
import ChangeDirectionIcon from "../components/ChangeDirectionIcon";
import ConfirmDeleteSheet from "../components/ConfirmDeleteSheet";
import StatTile from "../components/StatTile";
import { staggerStyle } from "../lib/stagger";

// Fixed lookback for the Weight Changes card and the Insights stat tiles —
// deliberately independent of the chart's own range/gesture window, the same
// way MacroFactor's "past three weeks" rate doesn't change when you flip the
// graph to 1Y. 120 days comfortably covers the widest change window (90-day)
// plus room for the 21-day rate calc to find a real start point.
const INSIGHTS_WINDOW_DAYS = 120;
const CHANGE_WINDOWS = [3, 7, 14, 30, 90];
const WEIGHT_CHANGE_COLOR = "#9085E9";

function formatRangeDate(dateStr: string, withYear: boolean): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: withYear ? "numeric" : undefined,
  });
}

function formatRangeLabel(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatRangeDate(endDate, true);
  return `${formatRangeDate(startDate, false)} – ${formatRangeDate(endDate, true)}`;
}

function signed(n: number): string {
  return n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}


export default function WeightDetailScreen() {
  const { unit } = useWeightUnit();
  const [showScale, setShowScale] = useState(true);
  const [showTrend, setShowTrend] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [pendingDeleteWeightId, setPendingDeleteWeightId] = useState<string | null>(null);

  // One dense fetch covers both the gesture-driven chart and the fixed
  // Insights window — the backend already computes the EWMA over full
  // history and just slices the response, so requesting the max once lets
  // pan/pinch re-slice an already-loaded array instead of refetching mid-gesture.
  const trend = useWeightTrend(3650);
  const allWeighIns = useWeights(3650);
  const deleteWeight = useDeleteWeight();

  const allTrendPoints = trend.data ?? [];
  const hasData = allTrendPoints.length > 0;

  const earliestTs = useMemo(
    () => (allTrendPoints.length ? dayIndex(allTrendPoints[0].date) : dayIndex(localDateString())),
    [allTrendPoints]
  );
  const gesture = useChartGesture({ earliestTs, initialDays: 30 });

  const chartPoints = useMemo(
    () => allTrendPoints.filter((p) => dayIndex(p.date) >= gesture.view.start && dayIndex(p.date) <= gesture.view.end),
    [allTrendPoints, gesture.view]
  );

  const insightsCutoff = addDays(localDateString(), -INSIGHTS_WINDOW_DAYS);
  const insightPoints = useMemo(
    () => allTrendPoints.filter((p) => p.date >= insightsCutoff),
    [allTrendPoints, insightsCutoff]
  );

  const rangeAvgKg = chartPoints.length
    ? chartPoints.reduce((sum, p) => sum + p.trendKg, 0) / chartPoints.length
    : null;
  const rangeDiffKg =
    chartPoints.length >= 2 ? chartPoints[chartPoints.length - 1].trendKg - chartPoints[0].trendKg : null;
  const rangeLabel = chartPoints.length
    ? formatRangeLabel(chartPoints[0].date, chartPoints[chartPoints.length - 1].date)
    : null;

  const latestTrendKg = insightPoints[insightPoints.length - 1]?.trendKg ?? null;
  const weeklyRateKg = weeklyTrendRateKgPerWeek(insightPoints);
  const energySurplusPerDay = weeklyRateKg !== null ? (weeklyRateKg / 7) * KCAL_PER_KG : null;
  const projection30Kg =
    latestTrendKg !== null && weeklyRateKg !== null ? projectTrendKg(latestTrendKg, weeklyRateKg, 30) : null;

  const onToggleScale = () => {
    if (showScale && !showTrend) return; // keep at least one series visible
    setShowScale((v) => !v);
  };
  const onToggleTrend = () => {
    if (showTrend && !showScale) return;
    setShowTrend((v) => !v);
  };

  // Grouped-by-month history with a day-over-day change indicator, computed
  // ascending first (so each entry can see the previous day it's compared
  // against) then reversed for display — most recent month, most recent day
  // first, matching the chronological reading order of the rest of the app.
  const sortedAsc = [...(allWeighIns.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const monthGroups = new Map<string, { label: string; entries: { id: string; date: string; weightKg: number; bodyFatPercent: number | null; deltaKg: number | null }[] }>();
  sortedAsc.forEach((w, i) => {
    const key = w.date.slice(0, 7);
    if (!monthGroups.has(key)) {
      const [y, m] = key.split("-").map(Number);
      monthGroups.set(key, {
        label: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        entries: [],
      });
    }
    monthGroups.get(key)!.entries.push({
      id: w.id,
      date: w.date,
      weightKg: w.weightKg,
      bodyFatPercent: w.bodyFatPercent,
      deltaKg: i > 0 ? Math.round((w.weightKg - sortedAsc[i - 1].weightKg) * 100) / 100 : null,
    });
  });
  const monthGroupsDesc = [...monthGroups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, g]) => ({ key, label: g.label, entries: [...g.entries].reverse() }));

  // Block-level stagger-in for the screen's own top-level cards (the
  // Dashboard's per-tile version doesn't apply here — this screen has no
  // mapped list, just a fixed sequence of hand-built sections), reset per
  // mount the same way; incremented inline below rather than tracked via
  // state since it only needs to number cards in render order once.
  let block = 0;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium text-center">Weight Trend</h1>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        <div className="tile-enter border border-line bg-surface rounded-2xl p-4" style={staggerStyle(block++, 60, 5)}>
          <div className="relative grid grid-cols-2 gap-6">
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10" />
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">Average</p>
              <p className="tabular text-2xl font-medium tracking-tight whitespace-nowrap">
                {rangeAvgKg !== null ? kgToUnit(rangeAvgKg, unit).toFixed(1) : "—"}{" "}
                <span className="text-sm font-normal text-muted">{unit}</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">Difference</p>
              <p className="tabular text-2xl font-medium tracking-tight whitespace-nowrap">
                {rangeDiffKg !== null ? signed(kgToUnit(rangeDiffKg, unit)) : "—"}{" "}
                <span className="text-sm font-normal text-muted">{unit}</span>
              </p>
            </div>
          </div>
          {rangeLabel && <p className="text-xs text-muted mt-2 text-center">{rangeLabel}</p>}
        </div>

        <div className="tile-enter" style={staggerStyle(block++, 60, 5)}>
          <ChartCard
            gesture={gesture}
            presets={RANGE_PRESETS}
            legend={
              <WeightChartLegend
                showTrend={showTrend}
                showScale={showScale}
                onToggleTrend={onToggleTrend}
                onToggleScale={onToggleScale}
              />
            }
          >
            {(windowStart, windowEnd, height) => (
              <WeightChart
                points={chartPoints}
                hasData={hasData}
                unit={unit}
                showScale={showScale}
                showTrend={showTrend}
                windowStart={windowStart}
                windowEnd={windowEnd}
                height={height}
              />
            )}
          </ChartCard>
        </div>

        <p className="text-[11px] tracking-widest uppercase text-muted px-1 pt-2">Insights &amp; Data</p>

        <div className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
          <div className="px-4 py-2.5 border-b border-line">
            <span className="text-[11px] tracking-widest uppercase text-muted">Weight changes</span>
          </div>
          {CHANGE_WINDOWS.map((w) => {
            const stat = trendChangeOverDays(insightPoints, w);
            if (stat.deltaKg === null) {
              return (
                <div key={w} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/60 last:border-b-0">
                  <span className="text-sm text-muted w-12 shrink-0">{w}-day</span>
                  <div className="flex-1 flex items-center justify-end pr-8">
                    <span className="text-[11px] text-muted/60 bg-line/20 px-3 py-1 rounded-full">Not enough data</span>
                  </div>
                </div>
              );
            }
            const dir = changeDirection(stat.deltaKg, 0.05);
            const seriesInUnit = stat.series.map((kg) => kgToUnit(kg, unit));
            return (
              <div key={w} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/60 last:border-b-0">
                <span className="text-sm text-muted w-12 shrink-0">{w}-day</span>
                <div className="flex-1 h-7 min-w-0">
                  <MiniLineSpark values={seriesInUnit} color={WEIGHT_CHANGE_COLOR} />
                </div>
                <span className="tabular text-sm w-20 text-right shrink-0 whitespace-nowrap">
                  {signed(kgToUnit(stat.deltaKg, unit))} {unit}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted w-[86px] justify-end shrink-0">
                  <ChangeDirectionIcon direction={dir} colorClassName="text-weight" />
                  {changeDirectionLabel(dir)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="tile-enter space-y-3" style={staggerStyle(block++, 60, 5)}>
          <StatTile
            value={latestTrendKg !== null ? kgToUnit(latestTrendKg, unit).toFixed(1) : "—"}
            unit={unit}
            label="Current Weight"
            description="Our estimate of your true weight after smoothing out day-to-day fluctuations."
          />
          <StatTile
            value={weeklyRateKg !== null ? signed(kgToUnit(weeklyRateKg, unit)) : "—"}
            unit={unit}
            label="Weekly Change"
            description={
              <>
                Your typical weekly rate of weight {weeklyRateKg !== null && weeklyRateKg < 0 ? "loss" : "gain"} over
                the past three weeks.
              </>
            }
          />
          <StatTile
            value={energySurplusPerDay !== null ? Math.round(Math.abs(energySurplusPerDay)).toLocaleString() : "—"}
            unit="kcal"
            label={<>Energy {energySurplusPerDay !== null && energySurplusPerDay < 0 ? "Deficit" : "Surplus"}</>}
            description={
              <>
                Our estimate of your average daily caloric{" "}
                {energySurplusPerDay !== null && energySurplusPerDay < 0 ? "deficit" : "surplus"}, based on your rate
                of weight change over the past three weeks.
              </>
            }
          />
          <StatTile
            value={projection30Kg !== null ? kgToUnit(projection30Kg, unit).toFixed(1) : "—"}
            unit={unit}
            label="30-Day Projection"
            description="Your projected weight in 30 days if your current rate is met."
          />
        </div>

        {monthGroupsDesc.length > 0 && (
          <div className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-left"
            >
              <span className="text-[11px] tracking-widest uppercase text-muted">History</span>
              <span className="text-xs text-accent">{showHistory ? "Hide" : "Show"}</span>
            </button>
            {showHistory &&
              monthGroupsDesc.map((g) => (
                <div key={g.key}>
                  <div className="px-4 py-2 border-t border-line bg-surface-raised">
                    <span className="text-xs text-muted">{g.label}</span>
                  </div>
                  {g.entries.map((w) => {
                    const dir = changeDirection(w.deltaKg, 0.01);
                    return (
                      <div
                        key={w.id}
                        className="flex items-center justify-between px-4 py-2.5 border-t border-line/60"
                      >
                        <div>
                          <p className="tabular text-sm">
                            {kgToUnit(w.weightKg, unit).toFixed(1)} {unit}
                            {w.bodyFatPercent !== null && (
                              <span className="text-muted"> · {w.bodyFatPercent.toFixed(1)}% BF</span>
                            )}
                          </p>
                          <p className="text-xs text-muted">{formatDayLabel(w.date)}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1 text-xs text-muted">
                            <ChangeDirectionIcon direction={dir} colorClassName="text-weight" />
                            {changeDirectionLabel(dir)}
                          </span>
                          <button
                            onClick={() => setPendingDeleteWeightId(w.id)}
                            aria-label={`Delete weigh-in from ${formatDayLabel(w.date)}`}
                            className="text-muted text-base leading-none px-1"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        )}
      </main>

      {pendingDeleteWeightId && (
        <ConfirmDeleteSheet
          title="Delete Weigh-In"
          message="Remove this weigh-in from your history? This can't be undone."
          confirmLabel="Delete Weigh-In"
          onConfirm={() => deleteWeight.mutate(pendingDeleteWeightId, { onSuccess: () => setPendingDeleteWeightId(null) })}
          onClose={() => setPendingDeleteWeightId(null)}
          isPending={deleteWeight.isPending}
        />
      )}
    </div>
  );
}
