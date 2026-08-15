import { useEffect, useMemo, useState } from "react";
import { Footprints } from "lucide-react";
import { useStepGoal, useSteps, useStepsStatus } from "../api/steps";
import { dayIndex, formatDayLabel, localDateString } from "../lib/date";
import { RANGE_PRESETS } from "../lib/chartLayout";
import { useChartGesture } from "../hooks/useChartGesture";
import ChartCard from "../components/ChartCard";
import StepsChart, { StepsChartLegend } from "../components/StepsChart";
import DecimalInput from "../components/DecimalInput";
import StatTile from "../components/StatTile";
import { staggerStyle } from "../lib/stagger";

function average(days: { steps: number | null }[]): number | null {
  const values = days.flatMap((day) => day.steps == null ? [] : [day.steps]);
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function number(value: number | null): string {
  return value == null ? "—" : value.toLocaleString();
}

export default function StepsDetailScreen() {
  const history = useSteps(3650);
  const status = useStepsStatus();
  const { goal, setGoal, saving } = useStepGoal();
  const [goalText, setGoalText] = useState(String(goal));
  useEffect(() => setGoalText(String(goal)), [goal]);

  const days = history.data?.days ?? [];
  const available = days.filter((day) => day.steps != null);
  const completed = days.filter((day) => day.state === "complete");
  const today = days.find((day) => day.date === (history.data?.today ?? localDateString()));
  const earliestTs = useMemo(() => dayIndex(available[0]?.date ?? localDateString()), [available]);
  const gesture = useChartGesture({ earliestTs, initialDays: 30 });
  const chartPoints = useMemo(() => days.filter((day) => {
    const ts = dayIndex(day.date);
    return ts >= gesture.view.start && ts <= gesture.view.end;
  }), [days, gesture.view]);

  // Calendar windows ending yesterday: today is always partial, and missing
  // days are excluded from the denominator rather than silently treated as
  // zeros. Real stored zero days remain in the denominator.
  const completed7 = days.slice(-8, -1).filter((day) => day.state === "complete");
  const completed30 = days.slice(-31, -1).filter((day) => day.state === "complete");
  const best = completed.reduce<typeof completed[number] | null>((winner, day) =>
    winner == null || (day.steps ?? -1) > (winner.steps ?? -1) ? day : winner, null);
  const reached = completed.filter((day) => (day.steps ?? 0) >= goal).length;
  const lastSync = status.data?.sync?.lastSuccessfulSyncAt;

  function saveGoal() {
    const parsed = Number(goalText);
    if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 100_000) setGoal(parsed);
    else setGoalText(String(goal));
  }

  let block = 0;
  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium text-center">Steps</h1>
      </header>
      <main className="px-4 space-y-3 max-w-md mx-auto">
        <section className="tile-enter border border-line bg-surface rounded-2xl p-4" style={staggerStyle(block++, 60, 5)}>
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-xl bg-carbs/10 text-carbs flex items-center justify-center"><Footprints size={22} /></span>
            <div className="flex-1">
              <p className="text-[11px] tracking-widest uppercase text-muted">Today · partial</p>
              <p className="tabular text-3xl font-medium tracking-tight">{number(today?.steps ?? null)} <span className="text-sm text-muted">steps</span></p>
            </div>
          </div>
          <div className="mt-3 h-2 bg-dashboardTrack rounded-full overflow-hidden">
            <div className="h-full bg-carbs rounded-full" style={{ width: `${Math.min(((today?.steps ?? 0) / goal) * 100, 100)}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-muted">Daily goal</span>
            <DecimalInput value={goalText} onChange={setGoalText} onDone={saveGoal} allowDecimal={false} disabled={saving} label="Daily step goal" className="min-w-24 rounded-full border border-line px-3 py-1.5 text-sm tabular text-right" />
          </div>
          <p className="text-[11px] text-muted mt-2">Last sync: {lastSync ? new Date(lastSync).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never"}</p>
        </section>

        <div className="tile-enter" style={staggerStyle(block++, 60, 5)}>
          <ChartCard gesture={gesture} presets={RANGE_PRESETS} legend={<StepsChartLegend />}>
            {(windowStart, windowEnd, height) => <StepsChart points={chartPoints} hasData={available.length > 0} goal={goal} windowStart={windowStart} windowEnd={windowEnd} height={height} />}
          </ChartCard>
        </div>

        <p className="text-[11px] tracking-widest uppercase text-muted px-1 pt-2">Summary</p>
        <StatTile value={number(average(completed7))} unit="steps/day" label="7-day average" description={`${completed7.length} completed available day${completed7.length === 1 ? "" : "s"}; today excluded.`} />
        <StatTile value={number(average(completed30))} unit="steps/day" label="30-day average" description={`${completed30.length} completed available day${completed30.length === 1 ? "" : "s"}; missing days excluded.`} />
        <StatTile value={number(best?.steps ?? null)} unit={best ? formatDayLabel(best.date) : undefined} label="Best day" description="Highest completed day in synced history." />
        <StatTile value={String(reached)} unit="days" label="Goal reached" description={`Completed days at or above ${goal.toLocaleString()} steps.`} />

        <section className="border border-line bg-surface rounded-2xl overflow-hidden mt-2">
          <div className="px-4 py-2.5 border-b border-line"><p className="text-[11px] tracking-widest uppercase text-muted">Recent days</p></div>
          {[...days].slice(-30).reverse().map((day) => (
            <div key={day.date} className="px-4 py-2.5 border-b border-line/60 last:border-b-0 flex items-center justify-between gap-3">
              <span className="text-sm">{formatDayLabel(day.date)}</span>
              <span className="text-right">
                <span className={`block tabular text-sm ${day.state === "missing" ? "text-muted" : ""}`}>{day.steps == null ? "Unavailable" : day.steps.toLocaleString()}</span>
                {day.state === "partial" && <span className="block text-[10px] text-calories">Partial</span>}
                {day.state === "complete" && day.steps === 0 && <span className="block text-[10px] text-muted">Recorded zero</span>}
              </span>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
