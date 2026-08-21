import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLogsHistory } from "../api/logs";
import { formatDayLabel, dayIndex, localDateString } from "../lib/date";
import { useChartGesture } from "../hooks/useChartGesture";
import { RANGE_PRESETS } from "../lib/chartLayout";
import MacroHistoryChart, { MacroHistoryChartLegend } from "../components/MacroHistoryChart";
import ChartCard from "../components/ChartCard";
import MonthSection from "../components/MonthSection";
import { staggerStyle } from "../lib/stagger";

const PROTEIN = "#EF8D6A";
const CARBS = "#5ABC80";
const FAT = "#F7D372";
const OTHER = "#749EF4";

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

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

export default function MacrosDetailScreen() {
  const navigate = useNavigate();
  // One dense fetch, same pattern as the other rebuilt nutrient/energy
  // screens — the chart slices its own window off this, the history list
  // filters to actually-logged days from the whole thing.
  const fullHistory = useLogsHistory(3650);
  const allHistory = fullHistory.data ?? [];
  const loggedDays = allHistory.filter((d) => d.logged && !d.incomplete);
  const hasData = loggedDays.length > 0;

  const earliestTs = useMemo(
    () => (loggedDays.length ? dayIndex(loggedDays[0].date) : dayIndex(localDateString())),
    [loggedDays]
  );
  const gesture = useChartGesture({ earliestTs, initialDays: 30 });

  const chartSlice = useMemo(
    () => loggedDays.filter((d) => dayIndex(d.date) >= gesture.view.start && dayIndex(d.date) <= gesture.view.end),
    [loggedDays, gesture.view]
  );

  const rangeAvg = chartSlice.length
    ? {
        protein: chartSlice.reduce((s, d) => s + d.protein, 0) / chartSlice.length,
        fat: chartSlice.reduce((s, d) => s + d.fat, 0) / chartSlice.length,
        carbs: chartSlice.reduce((s, d) => s + d.carbs, 0) / chartSlice.length,
      }
    : null;
  const rangeLabel = chartSlice.length ? formatRangeLabel(chartSlice[0].date, chartSlice[chartSlice.length - 1].date) : null;

  const monthGroups = new Map<
    string,
    { label: string; entries: { date: string; proteinPct: number; fatPct: number; carbsPct: number; otherPct: number }[] }
  >();
  [...loggedDays].forEach((d) => {
    const proteinKcal = d.protein * 4;
    const fatKcal = d.fat * 9;
    const carbsKcal = d.carbs * 4;
    const total = d.calories > 0 ? d.calories : proteinKcal + fatKcal + carbsKcal;
    // Percentages are of the day's *total* calories (protein+fat+carbs+other),
    // not just the P/F/C sum — matching MacroFactor's own numbers, which
    // don't always add to exactly 100% for the same reason (a residual
    // "Other" share, see MacroHistoryChart.tsx's toChartData).
    const otherKcal = Math.max(0, total - proteinKcal - fatKcal - carbsKcal);
    const entry = {
      date: d.date,
      proteinPct: total > 0 ? Math.round((proteinKcal / total) * 100) : 0,
      fatPct: total > 0 ? Math.round((fatKcal / total) * 100) : 0,
      carbsPct: total > 0 ? Math.round((carbsKcal / total) * 100) : 0,
      otherPct: total > 0 ? Math.round((otherKcal / total) * 100) : 0,
    };
    const key = d.date.slice(0, 7);
    if (!monthGroups.has(key)) {
      const [y, m] = key.split("-").map(Number);
      monthGroups.set(key, {
        label: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        entries: [],
      });
    }
    monthGroups.get(key)!.entries.push(entry);
  });
  const monthGroupsDesc = [...monthGroups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, g]) => ({ key, label: g.label, entries: [...g.entries].reverse() }));
  const currentMonth = localDateString().slice(0, 7);

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium text-center">Macros</h1>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        <div className="tile-enter border border-line bg-surface rounded-2xl p-4" style={staggerStyle(0, 60, 5)}>
          <div className="relative grid grid-cols-3 gap-6">
            <div className="pointer-events-none absolute inset-y-0 left-1/3 w-px -translate-x-1/2 bg-white/10" />
            <div className="pointer-events-none absolute inset-y-0 left-2/3 w-px -translate-x-1/2 bg-white/10" />
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">Protein</p>
              <p className="tabular text-xl font-medium tracking-tight whitespace-nowrap">
                {rangeAvg ? fmt(rangeAvg.protein) : "—"} <span className="text-sm font-normal text-muted">g</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">Fat</p>
              <p className="tabular text-xl font-medium tracking-tight whitespace-nowrap">
                {rangeAvg ? fmt(rangeAvg.fat) : "—"} <span className="text-sm font-normal text-muted">g</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">Carbs</p>
              <p className="tabular text-xl font-medium tracking-tight whitespace-nowrap">
                {rangeAvg ? fmt(rangeAvg.carbs) : "—"} <span className="text-sm font-normal text-muted">g</span>
              </p>
            </div>
          </div>
          {rangeLabel && <p className="text-xs text-muted mt-2 text-center">{rangeLabel}</p>}
        </div>

        <div className="tile-enter" style={staggerStyle(1, 60, 5)}>
          <ChartCard gesture={gesture} presets={RANGE_PRESETS} legend={<MacroHistoryChartLegend />}>
            {(windowStart, windowEnd, height) => (
              <MacroHistoryChart
                history={chartSlice}
                hasData={hasData}
                windowStart={windowStart}
                windowEnd={windowEnd}
                height={height}
              />
            )}
          </ChartCard>
        </div>

        {monthGroupsDesc.length > 0 && (
          <div className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(2, 60, 5)}>
            {monthGroupsDesc.map((g) => (
              <MonthSection
                key={g.key}
                label={g.label}
                summary={`${g.entries.length} ${g.entries.length === 1 ? "day" : "days"}`}
                defaultOpen={g.key === currentMonth}
              >
                {g.entries.map((d) => (
                  <button
                    key={d.date}
                    onClick={() => navigate(`/macros/${d.date}`)}
                    className="w-full text-left px-4 py-2.5 border-t border-line/60 active:bg-surface-raised"
                  >
                    <div className="flex items-center justify-between text-sm gap-2">
                      <span className="shrink-0">{formatDayLabel(d.date)}</span>
                      <span className="tabular text-muted text-xs truncate">
                        {d.proteinPct}% P • {d.fatPct}% F • {d.carbsPct}% C
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full mt-1.5 overflow-hidden flex bg-surface-raised">
                      {d.proteinPct > 0 && <div style={{ width: `${d.proteinPct}%`, background: PROTEIN }} />}
                      {d.fatPct > 0 && <div style={{ width: `${d.fatPct}%`, background: FAT }} />}
                      {d.carbsPct > 0 && <div style={{ width: `${d.carbsPct}%`, background: CARBS }} />}
                      {d.otherPct > 0 && <div style={{ width: `${d.otherPct}%`, background: OTHER }} />}
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
