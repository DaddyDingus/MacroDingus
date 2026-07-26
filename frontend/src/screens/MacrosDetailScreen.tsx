import { useState } from "react";
import { useDayLog, useLogsHistory } from "../api/logs";
import { useCoachStatus, useCheckinHistory } from "../api/coach";
import { localDateString, formatDayLabel } from "../lib/date";
import { activeCheckinForDate } from "../lib/checkins";
import { topContributors } from "../lib/nutrientContributors";
import MacroHistoryChart from "../components/MacroHistoryChart";
import RangeToggle from "../components/RangeToggle";

const RANGE_PRESETS = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export default function MacrosDetailScreen() {
  const [days, setDays] = useState(30);
  const today = localDateString();
  const dayLog = useDayLog(today);
  const coachStatus = useCoachStatus();
  const checkinHistory = useCheckinHistory();
  const history = useLogsHistory(days);

  const checkinsAsc = [...(checkinHistory.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const todayCheckin = coachStatus.data?.latestCheckin ?? null;
  const totalsToday = dayLog.data?.totals ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const contributors = topContributors(dayLog.data?.entries ?? [], "calories", 3);

  const withEntries = (history.data ?? []).filter((d) => d.calories > 0);
  const avg7 =
    withEntries.length > 0
      ? {
          calories: withEntries.slice(-7).reduce((s, d) => s + d.calories, 0) / Math.min(7, withEntries.length),
          protein: withEntries.slice(-7).reduce((s, d) => s + d.protein, 0) / Math.min(7, withEntries.length),
          carbs: withEntries.slice(-7).reduce((s, d) => s + d.carbs, 0) / Math.min(7, withEntries.length),
          fat: withEntries.slice(-7).reduce((s, d) => s + d.fat, 0) / Math.min(7, withEntries.length),
        }
      : null;

  const dailyList = [...(history.data ?? [])].reverse().map((d) => {
    const active = activeCheckinForDate(checkinsAsc, d.date);
    const target = active ? active.targetCalories : null;
    const pct = target ? Math.round((d.calories / target) * 100) : null;
    return { date: d.date, actual: d.calories, target, pct };
  });

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium">Macros</h1>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        {todayCheckin && (
          <div className="border border-line bg-surface rounded-md overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line">
              <span className="text-[11px] tracking-widest uppercase text-muted">Macros today</span>
            </div>
            <div className="px-5 py-2.5 flex items-center justify-between border-b border-line/70">
              <span className="flex items-center gap-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-protein" /> Protein
              </span>
              <span className="tabular text-sm">
                {fmt(totalsToday.protein, 1)} / {fmt(todayCheckin.targetProteinG, 1)} g
              </span>
            </div>
            <div className="px-5 py-2.5 flex items-center justify-between border-b border-line/70">
              <span className="flex items-center gap-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-carbs" /> Carbs
              </span>
              <span className="tabular text-sm">
                {fmt(totalsToday.carbs, 1)} / {fmt(todayCheckin.targetCarbsG, 1)} g
              </span>
            </div>
            <div className="px-5 py-2.5 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-fat" /> Fat
              </span>
              <span className="tabular text-sm">
                {fmt(totalsToday.fat, 1)} / {fmt(todayCheckin.targetFatG, 1)} g
              </span>
            </div>
          </div>
        )}

        {avg7 && (
          <div className="border border-line bg-surface rounded-md p-4 grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="tabular text-sm">{Math.round(avg7.calories)}</div>
              <div className="text-[11px] text-muted">kcal</div>
            </div>
            <div>
              <div className="tabular text-sm text-protein">{avg7.protein.toFixed(1)}</div>
              <div className="text-[11px] text-muted">protein</div>
            </div>
            <div>
              <div className="tabular text-sm text-carbs">{avg7.carbs.toFixed(1)}</div>
              <div className="text-[11px] text-muted">carbs</div>
            </div>
            <div>
              <div className="tabular text-sm text-fat">{avg7.fat.toFixed(1)}</div>
              <div className="text-[11px] text-muted">fat</div>
            </div>
            <div className="col-span-4 text-[11px] text-muted pt-1">daily avg, last 7 logged days</div>
          </div>
        )}

        <RangeToggle presets={RANGE_PRESETS} value={days} onChange={setDays} />

        <div className="border border-line bg-surface rounded-md p-4">
          <p className="text-[11px] tracking-widest uppercase text-muted mb-1">Macros</p>
          <MacroHistoryChart history={history.data ?? []} />
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
                <span className="tabular text-sm shrink-0">{fmt(c.amount)} kcal</span>
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
                  {d.target !== null ? ` / ${fmt(d.target)}` : ""} kcal
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
