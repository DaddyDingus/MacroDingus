import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useDayLog, useLogsHistory, type DayHistory } from "../api/logs";
import { usePrograms } from "../api/programs";
import { addDays, formatDayLabel } from "../lib/date";
import { targetsForDate } from "../lib/programTargets";
import MacroTimingChart from "../components/MacroTimingChart";
import { staggerStyle } from "../lib/stagger";

const PROTEIN = "#EF8D6A";
const CARBS = "#5ABC80";
const FAT = "#F7D372";
const OTHER = "#749EF4";

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

// Same calorie-contribution %-composition math MacrosDetailScreen's own
// history rows already use (protein/carbs *4, fat *9, "other" as the
// residual) — just summed across however many days the window covers
// instead of a single day, so Past Week/Past Month read as one combined
// composition bar rather than an average of daily percentages.
function windowComposition(history: Map<string, DayHistory>, date: string, days: number) {
  let protein = 0, fat = 0, carbs = 0, calories = 0;
  for (let i = 0; i < days; i++) {
    const row = history.get(addDays(date, -i));
    if (!row) continue;
    protein += row.protein;
    fat += row.fat;
    carbs += row.carbs;
    calories += row.calories;
  }
  const proteinKcal = protein * 4;
  const fatKcal = fat * 9;
  const carbsKcal = carbs * 4;
  const total = calories > 0 ? calories : proteinKcal + fatKcal + carbsKcal;
  const otherKcal = Math.max(0, total - proteinKcal - fatKcal - carbsKcal);
  return {
    proteinPct: total > 0 ? Math.round((proteinKcal / total) * 100) : 0,
    fatPct: total > 0 ? Math.round((fatKcal / total) * 100) : 0,
    carbsPct: total > 0 ? Math.round((carbsKcal / total) * 100) : 0,
    otherPct: total > 0 ? Math.round((otherKcal / total) * 100) : 0,
  };
}

// Reached by tapping a day row in MacrosDetailScreen's history list — the
// combined-macros sibling of NutrientDayDetailScreen, showing the same
// Today/Past-Week/Past-Month + Active Goal + Nutrient Timing shape but as a
// %-of-calories composition (matching MacrosDetailScreen's own history rows)
// rather than a single value/target. No "All Contributors" here — that's
// only meaningful for one nutrient at a time, not a P/F/C composite.
export default function MacrosDayDetailScreen() {
  const navigate = useNavigate();
  const { date } = useParams<{ date: string }>();
  const viewDate = date ?? "";

  const fullHistory = useLogsHistory(3650);
  const programs = usePrograms();
  const dayLog = useDayLog(viewDate);

  const byDate = new Map((fullHistory.data ?? []).map((d) => [d.date, d]));
  const rows = [
    { label: formatDayLabel(viewDate), comp: windowComposition(byDate, viewDate, 1) },
    { label: "Past Week", comp: windowComposition(byDate, viewDate, 7) },
    { label: "Past Month", comp: windowComposition(byDate, viewDate, 30) },
  ];

  const targets = targetsForDate(programs.data ?? [], viewDate);

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3 flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full text-ink active:bg-white/10"
        >
          <ChevronLeft size={20} strokeWidth={2.2} />
        </button>
        <h1 className="flex-1 text-lg font-medium text-center truncate">Macros</h1>
        <div className="h-9 w-9 shrink-0" />
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        <div className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(0, 60, 5)}>
          {rows.map((r) => (
            <div key={r.label} className="px-4 py-3 border-b border-line/60 last:border-b-0">
              <div className="flex items-center justify-between text-sm gap-2">
                <span className="shrink-0">{r.label}</span>
                <span className="tabular text-muted text-xs truncate">
                  {r.comp.proteinPct}% P • {r.comp.fatPct}% F • {r.comp.carbsPct}% C
                </span>
              </div>
              <div className="h-1.5 rounded-full mt-1.5 overflow-hidden flex bg-surface-raised">
                {r.comp.proteinPct > 0 && <div style={{ width: `${r.comp.proteinPct}%`, background: PROTEIN }} />}
                {r.comp.fatPct > 0 && <div style={{ width: `${r.comp.fatPct}%`, background: FAT }} />}
                {r.comp.carbsPct > 0 && <div style={{ width: `${r.comp.carbsPct}%`, background: CARBS }} />}
                {r.comp.otherPct > 0 && <div style={{ width: `${r.comp.otherPct}%`, background: OTHER }} />}
              </div>
            </div>
          ))}
        </div>

        <div className="tile-enter" style={staggerStyle(1, 60, 5)}>
          <p className="text-[11px] tracking-widest uppercase text-muted px-1 pb-2">Active Goal</p>
          <div className="border border-line bg-surface rounded-2xl p-4">
            <p className="text-sm font-semibold">Target</p>
            <p className="text-xs text-muted mt-0.5">Set According to Your Strategy</p>
            <p className="tabular text-lg font-medium tracking-tight mt-2">
              {targets ? `${fmt(targets.proteinG)} P  ${fmt(targets.fatG)} F  ${fmt(targets.carbsG)} C` : "—"}
            </p>
          </div>
        </div>

        <div className="tile-enter" style={staggerStyle(2, 60, 5)}>
          <p className="text-[11px] tracking-widest uppercase text-muted px-1 pb-2">Nutrient Timing</p>
          <div className="border border-line bg-surface rounded-2xl py-3">
            <MacroTimingChart entries={dayLog.data?.entries ?? []} />
          </div>
        </div>
      </main>
    </div>
  );
}
