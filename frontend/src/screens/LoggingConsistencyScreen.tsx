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
        <div className="tile-enter border border-line bg-surface rounded-2xl p-4" style={staggerStyle(0, 60, 5)}>
          <div className="relative grid grid-cols-2 gap-6">
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10" />
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted mb-1">Today</p>
              <div className="flex items-baseline justify-center gap-1">
                <p className="tabular text-2xl font-medium tracking-tight">
                  {Math.round(kcalToUnit(todayCalories, energyUnit)).toLocaleString()}
                </p>
                <span className="text-sm font-normal text-muted">{energyUnitLabel(energyUnit)}</span>
              </div>
            </div>
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted mb-1">Streak</p>
              <div className="flex items-baseline justify-center gap-1">
                <p className="tabular text-2xl font-medium tracking-tight">{streak}</p>
                <span className="text-sm font-normal text-muted">days</span>
              </div>
            </div>
          </div>
        </div>

        <div className="tile-enter" style={staggerStyle(1, 60, 5)}>
          <ConsistencyCalendar activeDates={activeDates} />
        </div>
      </main>
    </div>
  );
}
