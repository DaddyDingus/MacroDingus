import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDayLog } from "../api/logs";
import { useCoachStatus } from "../api/coach";
import { localDateString } from "../lib/date";
import ShortcutsBar from "../components/ShortcutsBar";
import DashboardTotalsArcCard from "../components/DashboardTotalsArcCard";

// The only piece of the dashboard that pulls in recharts — kept out of this
// screen's own (eager) bundle. See DashboardTileSections.tsx for why.
const DashboardTileSections = lazy(() => import("../components/DashboardTileSections"));

const ZERO = { calories: 0, protein: 0, carbs: 0, fat: 0 };

const HEADER_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });

export default function DashboardScreen() {
  const today = localDateString();

  const dayLog = useDayLog(today);
  const coachStatus = useCoachStatus();

  const navigate = useNavigate();
  const [mode, setMode] = useState<"total" | "remaining">("total");

  const totals = dayLog.data?.totals ?? ZERO;
  const checkin = coachStatus.data?.latestCheckin;
  const targets = checkin
    ? { calories: checkin.targetCalories, protein: checkin.targetProteinG, carbs: checkin.targetCarbsG, fat: checkin.targetFatG }
    : null;

  return (
    <div className="min-h-dvh pb-40 bg-dashboardBg">
      <header className="px-4 pt-5 pb-3">
        <p className="text-[11px] text-muted">{HEADER_DATE_FORMAT.format(new Date())}</p>
        <h1 className="text-2xl font-semibold tracking-tight mt-0.5">Dashboard</h1>
      </header>

      <main className="px-4 space-y-4 max-w-md mx-auto">
        <section>
          <p className="text-lg font-bold text-ink mb-3">Daily Nutrition</p>
          <DashboardTotalsArcCard totals={totals} targets={targets} mode={mode} onModeChange={setMode} />
        </section>

        <Suspense
          fallback={
            <div className="space-y-4">
              {Array.from({ length: 2 }).map((_, section) => (
                <div key={section} className="grid grid-cols-2 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="aspect-square bg-dashboardCard rounded-2xl p-4 animate-pulse" />
                  ))}
                </div>
              ))}
            </div>
          }
        >
          <DashboardTileSections />
        </Suspense>

        <button
          onClick={() => navigate("/dashboard/customize")}
          className="w-full text-center py-2.5 text-xs text-muted border border-line rounded-md active:bg-surface-raised"
        >
          Customise dashboard
        </button>
      </main>

      <ShortcutsBar />
    </div>
  );
}
