import { useLoggedDates, useDayLog } from "../api/logs";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";
import { localDateString } from "../lib/date";
import { computeCurrentStreak } from "../lib/habitStreak";
import ConsistencyCalendar from "../components/ConsistencyCalendar";
import { staggerStyle } from "../lib/stagger";

export default function LoggingConsistencyScreen() {
  const loggedDates = useLoggedDates();
  const today = localDateString();
  const todayLog = useDayLog(today);
  const { unit: energyUnit } = useEnergyUnit();

  const activeDates = new Set(loggedDates.data?.dates ?? []);
  const streak = computeCurrentStreak(activeDates, today);
  const todayCalories = todayLog.data?.totals.calories ?? 0;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium text-center">Food Logging</h1>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        <div className="tile-enter border border-line bg-surface rounded-2xl p-4 flex items-start gap-6" style={staggerStyle(0, 60, 5)}>
          <div>
            <p className="text-[11px] tracking-widest uppercase text-muted">Today</p>
            <p className="tabular text-2xl font-medium tracking-tight">
              {Math.round(kcalToUnit(todayCalories, energyUnit)).toLocaleString()}{" "}
              <span className="text-sm font-normal text-muted">{energyUnitLabel(energyUnit)}</span>
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
