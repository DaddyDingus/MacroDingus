import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useDayLog, useLogsHistory } from "../api/logs";
import { usePrograms } from "../api/programs";
import { localDateString, formatDayLabel, dayIndex } from "../lib/date";
import { targetsForDate, type DayTargets } from "../lib/programTargets";
import { topContributors } from "../lib/nutrientContributors";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";
import { useChartGesture } from "../hooks/useChartGesture";
import { RANGE_PRESETS } from "../lib/chartLayout";
import ChartCard from "../components/ChartCard";
import NutrientHistoryChart, { NutrientHistoryChartLegend, type NutrientChartPoint } from "../components/NutrientHistoryChart";
import MonthSection from "../components/MonthSection";
import { staggerStyle } from "../lib/stagger";

// Exported so NutrientDayDetailScreen (the per-day drill-in reached by
// tapping a history row below) can share the exact same label/color/target
// mapping instead of a second copy that could drift.
export const METRIC_CONFIG = {
  calories: {
    label: "Calories",
    unit: "kcal",
    color: "#749EF4",
    targetKey: "calories" as const,
    decimals: 0,
    about:
      "Calories are a measure of the energy your body gets from food and drink. Your body uses that energy for everything from basic survival — breathing, circulation, cell repair — to digestion, movement, and exercise.",
  },
  protein: {
    label: "Protein",
    unit: "g",
    color: "#EF8D6A",
    targetKey: "proteinG" as const,
    decimals: 1,
    about:
      "Protein is one of the three macronutrients. It's made of amino acids your body uses to build and repair muscle, skin, and enzymes. Unlike fat, your body can't store much extra protein for later, so getting enough of it regularly matters.",
  },
  carbs: {
    label: "Carbs",
    unit: "g",
    color: "#5ABC80",
    targetKey: "carbsG" as const,
    decimals: 1,
    about:
      "Carbohydrates are one of the three macronutrients. They're your body's preferred, most readily available source of energy, broken down into glucose to fuel your brain, muscles, and daily activity. Fiber, a type of carbohydrate your body can't fully digest, also supports gut health.",
  },
  fat: {
    label: "Fat",
    unit: "g",
    color: "#F7D372",
    targetKey: "fatG" as const,
    decimals: 1,
    about:
      "Fat is one of the three macronutrients. It's a concentrated source of energy, helps your body absorb fat-soluble vitamins (A, D, E, and K), and supplies essential fatty acids your body can't produce on its own.",
  },
};
export type MetricId = keyof typeof METRIC_CONFIG;

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

function signed(n: number, decimals: number): string {
  const s = n.toFixed(decimals);
  return n >= 0 ? `+${s}` : s;
}

export default function NutrientDetailScreen() {
  const navigate = useNavigate();
  const { metric } = useParams<{ metric: string }>();
  const metricId: MetricId = metric && metric in METRIC_CONFIG ? (metric as MetricId) : "calories";
  const config = METRIC_CONFIG[metricId];

  const [showAllContributors, setShowAllContributors] = useState(false);
  const { unit: energyUnit } = useEnergyUnit();
  const today = localDateString();
  const dayLog = useDayLog(today);
  // One dense fetch (same pattern as EnergyBalanceDetailScreen) — the chart
  // slices its own window off this, the daily history list uses the whole
  // thing filtered to actually-logged days, no separate round trips.
  const fullHistory = useLogsHistory(3650);
  const programs = usePrograms();

  const programList = programs.data ?? [];

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: config.decimals, minimumFractionDigits: config.decimals });
  // Only "calories" has a second unit to switch between — protein/carbs/fat
  // stay in grams regardless of the energy-unit preference, so `convert` is
  // the identity for those three and only calories routes through kcalToUnit.
  const convert = (n: number) => (metricId === "calories" ? kcalToUnit(n, energyUnit) : n);
  const unitLabel = metricId === "calories" ? energyUnitLabel(energyUnit) : config.unit;

  const contributors = topContributors(dayLog.data?.entries ?? [], metricId, showAllContributors ? 999 : 3);
  const consumedToday = dayLog.data?.totals[metricId] ?? 0;
  const targetsToday = targetsForDate(programList, today);
  const targetToday = targetsToday ? targetsToday[config.targetKey] : null;
  const pctToday = targetToday ? Math.min(100, Math.round((consumedToday / targetToday) * 100)) : null;

  const loggedDays = (fullHistory.data ?? []).filter((d) => d.logged && !d.incomplete);
  const allPoints: NutrientChartPoint[] = loggedDays.map((d) => {
    const dayTargets = targetsForDate(programList, d.date);
    return {
      date: d.date,
      value: convert(d[metricId]),
      target: dayTargets ? convert(dayTargets[config.targetKey]) : null,
    };
  });

  const hasData = loggedDays.length > 0;

  const earliestTs = useMemo(
    () => (loggedDays.length ? dayIndex(loggedDays[0].date) : dayIndex(today)),
    [loggedDays, today]
  );
  const gesture = useChartGesture({ earliestTs, initialDays: 30 });

  const chartPoints = useMemo(
    () => allPoints.filter((p) => dayIndex(p.date) >= gesture.view.start && dayIndex(p.date) <= gesture.view.end),
    [allPoints, gesture.view]
  );

  const rangeAvg = chartPoints.length ? chartPoints.reduce((s, p) => s + p.value, 0) / chartPoints.length : null;
  const rangeDiff = chartPoints.length >= 2 ? chartPoints[chartPoints.length - 1].value - chartPoints[0].value : null;
  const rangeLabel = chartPoints.length ? formatRangeLabel(chartPoints[0].date, chartPoints[chartPoints.length - 1].date) : null;

  const monthGroups = new Map<string, { label: string; entries: { date: string; actual: number; target: number | null; pct: number | null }[] }>();
  [...loggedDays].forEach((d) => {
    const dayTargets = targetsForDate(programList, d.date);
    const target = dayTargets ? dayTargets[config.targetKey] : null;
    const actual = d[metricId];
    const pct = target ? Math.round((actual / target) * 100) : null;
    const key = d.date.slice(0, 7);
    if (!monthGroups.has(key)) {
      const [y, m] = key.split("-").map(Number);
      monthGroups.set(key, {
        label: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        entries: [],
      });
    }
    monthGroups.get(key)!.entries.push({ date: d.date, actual, target, pct });
  });
  const monthGroupsDesc = [...monthGroups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, g]) => ({ key, label: g.label, entries: [...g.entries].reverse() }));

  let block = 0;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium text-center">{config.label}</h1>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        <div className="tile-enter border border-line bg-surface rounded-2xl p-4" style={staggerStyle(block++, 60, 5)}>
          <div className="relative grid grid-cols-2 gap-6">
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10" />
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">Average</p>
              <p className="tabular text-2xl font-medium tracking-tight whitespace-nowrap">
                {rangeAvg !== null ? fmt(rangeAvg) : "—"} <span className="text-sm font-normal text-muted">{unitLabel}</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">Difference</p>
              <p className="tabular text-2xl font-medium tracking-tight whitespace-nowrap">
                {rangeDiff !== null ? signed(rangeDiff, config.decimals) : "—"}{" "}
                <span className="text-sm font-normal text-muted">{unitLabel}</span>
              </p>
            </div>
          </div>
          {rangeLabel && <p className="text-xs text-muted mt-2 text-center">{rangeLabel}</p>}
        </div>

        <div className="tile-enter" style={staggerStyle(block++, 60, 5)}>
          <ChartCard
            gesture={gesture}
            presets={RANGE_PRESETS}
            legend={<NutrientHistoryChartLegend data={chartPoints} color={config.color} />}
          >
            {(windowStart, windowEnd, height) => (
              <NutrientHistoryChart
                data={chartPoints}
                hasData={hasData}
                color={config.color}
                unit={unitLabel}
                windowStart={windowStart}
                windowEnd={windowEnd}
                height={height}
              />
            )}
          </ChartCard>
        </div>

        <div className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
          <div className="px-4 py-3">
            <p className="text-sm font-semibold mb-2">About {config.label}</p>
            <p className="text-xs text-muted leading-relaxed">{config.about}</p>
          </div>
        </div>

        <div className="tile-enter border border-line bg-surface rounded-2xl p-4" style={staggerStyle(block++, 60, 5)}>
          <p className="text-sm font-semibold mb-2">{config.label} Today</p>
          <div className="flex items-center justify-between text-sm">
            <span>{config.label}</span>
            <span className="tabular">
              {fmt(convert(consumedToday))}
              {targetToday !== null ? ` / ${fmt(convert(targetToday))}` : ""} {unitLabel}
              {pctToday !== null && <span className="text-muted ml-2">{pctToday}%</span>}
            </span>
          </div>
          <div className="h-1.5 bg-surface-raised rounded-full mt-2 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pctToday ?? 0}%`, background: config.color }} />
          </div>
        </div>

        {contributors.length > 0 && (
          <div className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
            <button
              onClick={() => setShowAllContributors((v) => !v)}
              className="w-full px-4 py-2.5 flex items-center justify-between border-b border-line text-left"
            >
              <span className="text-[11px] tracking-widest uppercase text-muted">
                {showAllContributors ? "All contributors today" : "Top 3 contributors today"}
              </span>
              <ChevronDown className={`w-4 h-4 text-muted transition-transform ${showAllContributors ? "rotate-180" : ""}`} strokeWidth={2} />
            </button>
            {contributors.map((c) => (
              <div key={c.foodId} className="flex items-center justify-between px-4 py-2.5 border-b border-line/60 last:border-b-0">
                <span className="text-sm truncate pr-2">{c.name}</span>
                <span className="tabular text-sm shrink-0">
                  {fmt(convert(c.amount))} {unitLabel}
                </span>
              </div>
            ))}
          </div>
        )}

        {monthGroupsDesc.length > 0 && (
          <div className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
            {monthGroupsDesc.map((g, gi) => (
              <MonthSection
                key={g.key}
                label={g.label}
                summary={`${g.entries.length} ${g.entries.length === 1 ? "day" : "days"}`}
                defaultOpen={gi === 0}
              >
                {g.entries.map((d) => (
                  <button
                    key={d.date}
                    onClick={() => navigate(`/nutrition/${metricId}/${d.date}`)}
                    className="w-full text-left px-4 py-2.5 border-t border-line/60 active:bg-surface-raised"
                  >
                    <div className="flex items-center justify-between text-sm gap-2">
                      <span className="text-muted shrink-0">{formatDayLabel(d.date)}</span>
                      <span className="tabular truncate">
                        {fmt(convert(d.actual))}
                        {d.target !== null ? ` / ${fmt(convert(d.target))}` : ""} {unitLabel}
                        {d.pct !== null && <span className="text-muted ml-2">{d.pct}%</span>}
                      </span>
                    </div>
                    <div className="h-1.5 bg-surface-raised rounded-full mt-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(100, d.pct ?? 0)}%`, background: config.color }}
                      />
                    </div>
                  </button>
                ))}
              </MonthSection>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
