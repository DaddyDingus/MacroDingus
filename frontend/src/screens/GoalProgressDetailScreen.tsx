import { useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, Activity } from "lucide-react";
import { useCoachStatus } from "../api/coach";
import type { Goal } from "../api/goals";
import { useWeights, useWeightTrend } from "../api/weights";
import { useWeightUnit, kgToUnit, type WeightUnit } from "../lib/weightUnit";
import { daysBetween, localDateString } from "../lib/date";
import { computeGoalWeightSeries, computeOptimisticEtaDate } from "../lib/goalProgressInsights";
import ScreenTabs from "../components/ScreenTabs";
import GoalWaterfallChart from "../components/GoalWaterfallChart";
import StatTile from "../components/StatTile";
import { staggerStyle } from "../lib/stagger";

type GoalTab = "scale" | "trend";

const TAB_CONFIG: Record<GoalTab, { label: string; color: string }> = {
  scale: { label: "Scale Weight", color: "#059669" }, // `goal` token — same green the Dashboard's Scale Weight tile already uses
  trend: { label: "Trend Weight", color: "#9085E9" }, // `weight` token — same violet WeightChart/TdeeChart's TDEE cousin already uses
};

function formatFullDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

// "Aug 26" + "2026" on its own line, rather than one long string wrapping
// mid-word inside the fixed-width square — same information, shaped to fit.
function formatEtaParts(dateStr: string): { main: string; year: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return {
    main: date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    year: String(y),
  };
}

export default function GoalProgressDetailScreen() {
  const [tab, setTab] = useState<GoalTab>("scale");
  const status = useCoachStatus();
  const { unit } = useWeightUnit();
  const weighIns = useWeights(3650);
  const trend = useWeightTrend(3650);

  const activeGoal = status.data?.activeGoal ?? null;
  const trendWeightKg = status.data?.trendWeightKg ?? null;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium text-center">Goal Progress</h1>
      </header>

      {!activeGoal ? (
        <main className="px-4 max-w-md mx-auto">
          <div className="border border-line bg-surface rounded-2xl p-4 space-y-2">
            <p className="text-sm text-muted">You haven't set a goal yet.</p>
            <Link to="/strategy" className="text-sm text-accent inline-block">
              Set a goal →
            </Link>
          </div>
        </main>
      ) : activeGoal.goalWeightKg == null ? (
        <main className="px-4 max-w-md mx-auto">
          <div className="border border-line bg-surface rounded-2xl p-4">
            <p className="text-sm text-muted">Goal progress isn't tracked for maintain-weight goals — there's no target weight to measure distance to.</p>
          </div>
        </main>
      ) : activeGoal.startWeightKg == null || trendWeightKg == null ? (
        <main className="px-4 max-w-md mx-auto">
          <div className="border border-line bg-surface rounded-2xl p-4">
            <p className="text-sm text-muted">Log a weight to start tracking progress toward your goal.</p>
          </div>
        </main>
      ) : (
        <GoalProgressBody
          tab={tab}
          setTab={setTab}
          goal={activeGoal}
          trendWeightKg={trendWeightKg}
          weighInsAsc={[...(weighIns.data ?? [])].sort((a, b) => a.date.localeCompare(b.date))}
          trendPointsAsc={trend.data ?? []}
          unit={unit}
        />
      )}
    </div>
  );
}

function GoalProgressBody({
  tab,
  setTab,
  goal,
  trendWeightKg,
  weighInsAsc,
  trendPointsAsc,
  unit,
}: {
  tab: GoalTab;
  setTab: (t: GoalTab) => void;
  goal: Goal;
  trendWeightKg: number;
  weighInsAsc: { date: string; weightKg: number }[];
  trendPointsAsc: { date: string; trendKg: number }[];
  unit: WeightUnit;
}) {
  const config = TAB_CONFIG[tab];
  const today = localDateString();
  const goalStartDate = goal.startedDate;
  const goalWeightKg = goal.goalWeightKg!;
  const startWeightKg = goal.startWeightKg!;

  const points = tab === "scale" ? weighInsAsc.map((w) => ({ date: w.date, valueKg: w.weightKg })) : trendPointsAsc.map((p) => ({ date: p.date, valueKg: p.trendKg }));

  const latestScaleKg = weighInsAsc.length ? weighInsAsc[weighInsAsc.length - 1].weightKg : null;
  const currentKg = tab === "scale" ? latestScaleKg : trendWeightKg;
  const distanceKg = currentKg !== null ? Math.abs(goalWeightKg - currentKg) : null;
  // Total planned change (start -> goal), not yet-covered distance — lets
  // "Distance" (what's left) sit alongside a relative sense of how far along
  // that is, rather than two views of the same absolute number.
  const totalPlannedKg = Math.abs(goalWeightKg - startWeightKg);
  const progressPct =
    distanceKg !== null && totalPlannedKg > 0
      ? Math.min(100, Math.max(0, Math.round(((totalPlannedKg - distanceKg) / totalPlannedKg) * 100)))
      : null;

  const weightSeries = computeGoalWeightSeries(points, goalStartDate, startWeightKg, goalWeightKg, today);
  const etaDate = distanceKg !== null ? computeOptimisticEtaDate(distanceKg, goal.targetRateKgPerWeek, today) : null;
  const durationDays = daysBetween(goalStartDate, today);

  return (
    <>
      <ScreenTabs
        options={[
          { value: "scale", label: "Scale Weight", icon: <TrendingUp className="w-4 h-4" strokeWidth={2} /> },
          { value: "trend", label: "Trend Weight", icon: <Activity className="w-4 h-4" strokeWidth={2} /> },
        ]}
        value={tab}
        onChange={setTab}
      />

      <main className="px-4 pt-3 space-y-3 max-w-md mx-auto">
        <div className="tile-enter border border-line bg-surface rounded-2xl p-4" style={staggerStyle(0, 60, 5)}>
          <div className="relative grid grid-cols-2 gap-6">
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10" />
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">Remaining</p>
              <p className="tabular text-2xl font-medium tracking-tight">
                {distanceKg !== null ? kgToUnit(distanceKg, unit).toFixed(1) : "—"}{" "}
                <span className="text-sm font-normal text-muted">{unit}</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">Complete</p>
              <p className="tabular text-2xl font-medium tracking-tight">
                {progressPct !== null ? progressPct : "—"} <span className="text-sm font-normal text-muted">%</span>
              </p>
            </div>
          </div>
          <p className="text-xs text-muted mt-2 text-center">{formatFullDate(goalStartDate)} – Today</p>
        </div>

        <div className="tile-enter border border-line bg-surface rounded-2xl p-4" style={staggerStyle(1, 60, 5)}>
          <GoalWaterfallChart
            series={weightSeries}
            color={config.color}
            unit={unit}
            targetWeightKg={goalWeightKg}
            title={config.label}
          />
        </div>

        <p className="text-[11px] tracking-widest uppercase text-muted px-1 pt-2">Insights &amp; Data</p>

        <div className="tile-enter space-y-3" style={staggerStyle(2, 60, 5)}>
          <StatTile
            value={kgToUnit(goalWeightKg, unit).toFixed(1)}
            unit={unit}
            label="Target Weight"
            description="The target you selected during goal creation."
          />
          <StatTile
            value={String(durationDays)}
            unit="days"
            label="Duration"
            description="The number of days you've spent pursuing your current goal."
          />
          <StatTile
            value={etaDate ? formatEtaParts(etaDate).main : "—"}
            unit={etaDate ? formatEtaParts(etaDate).year : undefined}
            valueClassName="text-lg"
            label="Estimated Goal Date"
            description={`Estimate of when you'd reach your goal if you achieve and sustain your intended rate of weight change, based on ${
              tab === "scale" ? "scale weight" : "trend weight"
            }.`}
          />
        </div>
      </main>
    </>
  );
}
