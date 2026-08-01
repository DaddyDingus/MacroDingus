import { useWeights } from "../api/weights";
import { useWeightUnit, kgToUnit } from "../lib/weightUnit";
import { localDateString } from "../lib/date";
import { computeCurrentStreak } from "../lib/habitStreak";
import ConsistencyCalendar from "../components/ConsistencyCalendar";
import { staggerStyle } from "../lib/stagger";

export default function WeighInConsistencyScreen() {
  const weighIns = useWeights(3650);
  const { unit } = useWeightUnit();
  const today = localDateString();

  const activeDates = new Set((weighIns.data ?? []).map((w) => w.date));
  const todayEntry = (weighIns.data ?? []).find((w) => w.date === today);
  const streak = computeCurrentStreak(activeDates, today);

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium text-center">Weigh-In</h1>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        <div className="tile-enter border border-line bg-surface rounded-2xl p-4 flex items-start gap-6" style={staggerStyle(0, 60, 5)}>
          <div>
            <p className="text-[11px] tracking-widest uppercase text-muted">Today</p>
            <p className="tabular text-2xl font-medium tracking-tight">
              {todayEntry ? kgToUnit(todayEntry.weightKg, unit).toFixed(1) : "—"}{" "}
              <span className="text-sm font-normal text-muted">{unit}</span>
            </p>
          </div>
          <div>
            <p className="text-[11px] tracking-widest uppercase text-muted">Streak</p>
            <p className="tabular text-2xl font-medium tracking-tight">
              {streak} <span className="text-sm font-normal text-muted">days</span>
            </p>
          </div>
        </div>

        <div className="tile-enter" style={staggerStyle(1, 60, 5)}>
          <ConsistencyCalendar activeDates={activeDates} />
        </div>
      </main>
    </div>
  );
}
