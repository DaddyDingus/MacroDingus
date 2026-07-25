import { lazy, Suspense, useState } from "react";
import { useDayLog } from "../api/logs";
import { useCoachStatus } from "../api/coach";
import { localDateString } from "../lib/date";
import { SHORTCUT_CATALOG, useDashboardShortcuts, type ShortcutId } from "../lib/shortcuts";
import QuickActionFlow from "../components/QuickActionFlow";

// The only piece of the dashboard that pulls in recharts — kept out of this
// screen's own (eager) bundle. See DashboardInsights.tsx for why.
const DashboardInsights = lazy(() => import("../components/DashboardInsights"));

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

const ZERO = { calories: 0, protein: 0, carbs: 0, fat: 0 };

export default function DashboardScreen() {
  const today = localDateString();
  const { shortcuts } = useDashboardShortcuts();

  const dayLog = useDayLog(today);
  const coachStatus = useCoachStatus();

  const [mode, setMode] = useState<"total" | "remaining">("total");
  const [runningAction, setRunningAction] = useState<ShortcutId | null>(null);

  const totals = dayLog.data?.totals ?? ZERO;
  const checkin = coachStatus.data?.latestCheckin;
  const targets = checkin
    ? { calories: checkin.targetCalories, protein: checkin.targetProteinG, carbs: checkin.targetCarbsG, fat: checkin.targetFatG }
    : null;

  const display =
    mode === "remaining" && targets
      ? {
          calories: targets.calories - totals.calories,
          protein: targets.protein - totals.protein,
          carbs: targets.carbs - totals.carbs,
          fat: targets.fat - totals.fat,
        }
      : totals;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium">Dashboard</h1>
      </header>

      <main className="px-4 space-y-4 max-w-md mx-auto">
        <div className="border border-line bg-surface rounded-md overflow-hidden">
          <div className="px-5 pt-4 pb-2 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] tracking-widest uppercase text-muted">
                {mode === "remaining" ? "Remaining today" : "Today's totals"}
              </p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="tabular text-4xl font-medium tracking-tight">{fmt(display.calories)}</span>
                <span className="text-sm text-muted">kcal</span>
              </div>
            </div>
            {targets && (
              <div className="flex rounded-full border border-line overflow-hidden text-xs shrink-0">
                <button
                  onClick={() => setMode("total")}
                  className={`px-2.5 py-1 ${mode === "total" ? "bg-accent" : "text-muted"}`}
                  style={mode === "total" ? { color: "#0B1210" } : undefined}
                >
                  Total
                </button>
                <button
                  onClick={() => setMode("remaining")}
                  className={`px-2.5 py-1 ${mode === "remaining" ? "bg-accent" : "text-muted"}`}
                  style={mode === "remaining" ? { color: "#0B1210" } : undefined}
                >
                  Remaining
                </button>
              </div>
            )}
          </div>

          <div className="h-[3px] bg-ink" />

          <div className="px-5 py-2.5 flex items-center justify-between border-b border-line/70">
            <span className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-protein" /> Protein
            </span>
            <span className="tabular text-sm">{fmt(display.protein, 1)} g</span>
          </div>
          <div className="px-5 py-2.5 flex items-center justify-between border-b border-line/70">
            <span className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-carbs" /> Carbs
            </span>
            <span className="tabular text-sm">{fmt(display.carbs, 1)} g</span>
          </div>
          <div className="px-5 py-2.5 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-fat" /> Fat
            </span>
            <span className="tabular text-sm">{fmt(display.fat, 1)} g</span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {shortcuts.map((id) => {
            const s = SHORTCUT_CATALOG.find((c) => c.id === id);
            if (!s) return null;
            return (
              <button
                key={id}
                onClick={() => setRunningAction(id)}
                className="border border-line bg-surface rounded-md py-3 px-1 text-center active:bg-surface-raised"
              >
                <span className="block text-xs leading-tight">{s.label}</span>
              </button>
            );
          })}
        </div>

        <Suspense
          fallback={
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border border-line bg-surface rounded-md p-4 h-[104px] animate-pulse" />
              ))}
            </div>
          }
        >
          <DashboardInsights />
        </Suspense>
      </main>

      {runningAction && <QuickActionFlow action={runningAction} onClose={() => setRunningAction(null)} />}
    </div>
  );
}
