import { useState } from "react";
import { useParams } from "react-router-dom";
import { useDayLog, useLogsHistory } from "../api/logs";
import { useCoachStatus, useCheckinHistory } from "../api/coach";
import { localDateString, formatDayLabel } from "../lib/date";
import { activeCheckinForDate } from "../lib/checkins";
import { topContributors } from "../lib/nutrientContributors";
import RangeToggle from "../components/RangeToggle";
import NutrientHistoryChart from "../components/NutrientHistoryChart";

const METRIC_CONFIG = {
  calories: { label: "Calories", unit: "kcal", color: "#6BE4C0", targetKey: "targetCalories" as const, decimals: 0 },
  protein: { label: "Protein", unit: "g", color: "#D95926", targetKey: "targetProteinG" as const, decimals: 1 },
  carbs: { label: "Carbs", unit: "g", color: "#3987E5", targetKey: "targetCarbsG" as const, decimals: 1 },
  fat: { label: "Fat", unit: "g", color: "#199E70", targetKey: "targetFatG" as const, decimals: 1 },
};
type MetricId = keyof typeof METRIC_CONFIG;

const RANGE_PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
];

export default function NutrientDetailScreen() {
  const { metric } = useParams<{ metric: string }>();
  const metricId: MetricId = metric && metric in METRIC_CONFIG ? (metric as MetricId) : "calories";
  const config = METRIC_CONFIG[metricId];

  const [days, setDays] = useState(30);
  const today = localDateString();
  const dayLog = useDayLog(today);
  const history = useLogsHistory(days);
  const checkinHistory = useCheckinHistory();
  const coachStatus = useCoachStatus();

  const checkinsAsc = [...(checkinHistory.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const todayCheckin = coachStatus.data?.latestCheckin ?? null;

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: config.decimals, minimumFractionDigits: config.decimals });

  const consumedToday = dayLog.data?.totals[metricId] ?? 0;
  const targetToday = todayCheckin ? todayCheckin[config.targetKey] : null;
  const remainingToday = targetToday !== null ? targetToday - consumedToday : null;

  const contributors = topContributors(dayLog.data?.entries ?? [], metricId, 3);
  const chartData = (history.data ?? []).map((d) => ({ date: d.date, value: d[metricId] }));

  const dailyList = [...(history.data ?? [])].reverse().map((d) => {
    const active = activeCheckinForDate(checkinsAsc, d.date);
    const target = active ? active[config.targetKey] : null;
    const actual = d[metricId];
    const pct = target ? Math.round((actual / target) * 100) : null;
    return { date: d.date, actual, target, pct };
  });

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium">{config.label}</h1>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        <RangeToggle presets={RANGE_PRESETS} value={days} onChange={setDays} />

        <div className="border border-line bg-surface rounded-md p-4">
          <p className="text-[11px] tracking-widest uppercase text-muted mb-1">{config.label} over time</p>
          <NutrientHistoryChart data={chartData} color={config.color} unit={config.unit} />
        </div>

        <div className="border border-line bg-surface rounded-md p-4">
          <p className="text-[11px] tracking-widest uppercase text-muted">{config.label} today</p>
          <p className="tabular text-3xl font-medium tracking-tight">
            {fmt(consumedToday)} {config.unit}
          </p>
          {remainingToday !== null && (
            <p className="tabular text-xs text-muted mt-1">
              {fmt(Math.abs(remainingToday))} {config.unit} {remainingToday >= 0 ? "remaining" : "over"}
            </p>
          )}
        </div>

        {contributors.length > 0 && (
          <div className="border border-line bg-surface rounded-md overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line">
              <span className="text-[11px] tracking-widest uppercase text-muted">Top contributors today</span>
            </div>
            {contributors.map((c) => (
              <div
                key={c.foodId}
                className="flex items-center justify-between px-4 py-2.5 border-b border-line/60 last:border-b-0"
              >
                <span className="text-sm truncate pr-2">{c.name}</span>
                <span className="tabular text-sm shrink-0">
                  {fmt(c.amount)} {config.unit}
                </span>
              </div>
            ))}
          </div>
        )}

        {dailyList.length > 0 && (
          <div className="border border-line bg-surface rounded-md overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line">
              <span className="text-[11px] tracking-widest uppercase text-muted">Daily history</span>
            </div>
            {dailyList.map((d) => (
              <div
                key={d.date}
                className="flex items-center justify-between px-4 py-2 border-b border-line/60 last:border-b-0 text-sm gap-2"
              >
                <span className="text-muted shrink-0">{formatDayLabel(d.date)}</span>
                <span className="tabular truncate">
                  {fmt(d.actual)}
                  {d.target !== null ? ` / ${fmt(d.target)}` : ""} {config.unit}
                </span>
                {d.pct !== null && <span className="tabular text-muted w-12 text-right shrink-0">{d.pct}%</span>}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
